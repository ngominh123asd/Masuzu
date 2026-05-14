"""
FastAPI backend — WebSocket streaming + REST endpoints for the Claude Agent Platform.
"""
from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import os
import shutil
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, UploadFile, File as FastAPIFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from db.engine import async_session_factory, init_db, close_db, get_session
from db import repository as repo
from cli_runner import CLIRunner
from session_manager import SessionManager
from module_registry import registry
from plugin_registry import plugin_registry, IMPORTED_PLUGINS_DIR

# ──────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────
# Global instances
# ──────────────────────────────────────────────
cli_runner = CLIRunner()
session_mgr = SessionManager()


# ──────────────────────────────────────────────
# Lifespan
# ──────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing database...")
    await init_db()

    # Reset any sessions stuck in "running" from a previous crash
    async with async_session_factory() as db:
        stuck = await repo.reset_running_sessions(db)
        if stuck:
            logger.info(f"Reset {stuck} stuck 'running' sessions to 'idle'")
        await db.commit()

    logger.info("Loading modules...")
    registry.load_all_modules()

    logger.info("Scanning plugins...")
    plugins = plugin_registry.scan_all()
    logger.info(f"Discovered {len(plugins)} plugins")

    logger.info("Claude Agent Backend ready")
    yield
    # Shutdown
    await close_db()
    logger.info("Backend shutdown complete")


# ──────────────────────────────────────────────
# App
# ──────────────────────────────────────────────
app = FastAPI(
    title="Claude Agent Platform",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────
# Request/Response Models
# ──────────────────────────────────────────────
class CreateSessionRequest(BaseModel):
    project_name: str


class RunTaskRequest(BaseModel):
    task: str
    max_turns: int = 50
    model: str | None = None


class SearchRequest(BaseModel):
    query_embedding: list[float]
    limit: int = 10
    session_id: str | None = None


class SessionResponse(BaseModel):
    id: str
    project_name: str
    workspace_path: str
    status: str
    active_modules: list[str]
    created_at: str
    last_active: str


def _session_to_response(s) -> dict:
    return {
        "id": s.id,
        "project_name": s.project_name,
        "workspace_path": s.workspace_path,
        "status": s.status,
        "active_modules": s.active_modules if hasattr(s, "active_modules") else [],
        "created_at": s.created_at.isoformat() if s.created_at else "",
        "last_active": s.last_active.isoformat() if s.last_active else "",
    }


# ──────────────────────────────────────────────
# DB dependency
# ──────────────────────────────────────────────
async def get_db():
    async with async_session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


# ──────────────────────────────────────────────
# WebSocket — stream output realtime
# ──────────────────────────────────────────────
@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    logger.info(f"WebSocket connected: {session_id}")

    # Track running tasks for this connection to allow cancellation
    running_task: asyncio.Task | None = None

    async def run_task_wrapper(task_msg: dict):
        nonlocal running_task
        try:
            task = task_msg.get("task", "")
            max_turns = task_msg.get("max_turns", 50)
            model = task_msg.get("model")

            async with async_session_factory() as db:
                session = await session_mgr.get_session(session_id, db)
                if not session:
                    await websocket.send_json({"type": "error", "content": "Session not found"})
                    return

                # Update status
                await session_mgr.update_status(session_id, "running", db)

                # Log the task
                session_mgr.append_session_log(session_id, f"TASK: {task}")

                # Persist user message to DB
                await repo.add_message(db, session_id, "user", task, "text")
                await db.commit()

            # Buffer for batch DB writes
            _msg_buffer: list[dict] = []
            BATCH_SIZE = 20

            async def _flush_buffer():
                if not _msg_buffer:
                    return
                batch = _msg_buffer.copy()
                _msg_buffer.clear()
                try:
                    async with async_session_factory() as db:
                        for ev in batch:
                            await repo.add_message(
                                db, session_id, "assistant",
                                ev.get("content", ""),
                                ev.get("type", "assistant"),
                                meta=ev,
                            )
                        await db.commit()
                except Exception as e:
                    logger.error(f"DB batch flush error: {e}")

            # Stream callback
            async def on_output(event: dict):
                try:
                    db_only = event.pop("_db_only", False)

                    # Send to WebSocket
                    if not db_only:
                        await websocket.send_json(event)

                    # Buffer message; flush every BATCH_SIZE events
                    if event.get("type") not in ("token", "tool_stream", "tool_start"):
                        _msg_buffer.append(event)
                        if len(_msg_buffer) >= BATCH_SIZE:
                            await _flush_buffer()

                    # Append to session log
                    session_mgr.append_session_log(
                        session_id,
                        f"[{event.get('type', '?')}] {event.get('content', '')[:200]}"
                    )
                except Exception as e:
                    logger.error(f"Output callback error: {e}")

            # Run the task
            result = await cli_runner.run_task(
                task=task,
                workspace_path=session.workspace_path,
                session_id=session_id,
                max_turns=max_turns,
                on_output=on_output,
                model=model,
            )

            # Flush remaining buffered messages
            await _flush_buffer()

            # Update status after completion
            async with async_session_factory() as db:
                new_status = "idle" if result.success else "error"
                await session_mgr.update_status(session_id, new_status, db)
        except asyncio.CancelledError:
            logger.info(f"Task wrapper cancelled for {session_id}")
        except Exception as e:
            logger.exception(f"Error in task_runner for {session_id}: {e}")
            try:
                await websocket.send_json({"type": "error", "content": str(e)})
            except:
                pass
        finally:
            running_task = None

    try:
        while True:
            # Receive task requests from frontend
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg.get("action") == "run":
                if running_task and not running_task.done():
                    await websocket.send_json({"type": "error", "content": "A task is already running in this session"})
                    continue
                running_task = asyncio.create_task(run_task_wrapper(msg))

            elif msg.get("action") == "cancel":
                cancelled = await cli_runner.cancel_task(session_id)
                # If we have a local task wrapper, we should also cancel it to clean up
                if running_task and not running_task.done():
                    running_task.cancel()
                
                await websocket.send_json({
                    "type": "status",
                    "content": "cancelled" if cancelled else "no_task_running",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {session_id}")
    except Exception as e:
        logger.exception(f"WebSocket error for {session_id}: {e}")


# ──────────────────────────────────────────────
# REST — Sessions
# ──────────────────────────────────────────────
@app.post("/api/sessions")
async def create_session(req: CreateSessionRequest, db: AsyncSession = Depends(get_db)):
    session = await session_mgr.create_session(req.project_name, db)
    return _session_to_response(session)


@app.get("/api/sessions")
async def list_sessions(db: AsyncSession = Depends(get_db)):
    sessions = await session_mgr.list_sessions(db)
    return [_session_to_response(s) for s in sessions]


@app.get("/api/sessions/{session_id}")
async def get_session_info(session_id: str, db: AsyncSession = Depends(get_db)):
    session = await session_mgr.get_session(session_id, db)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return _session_to_response(session)


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str, db: AsyncSession = Depends(get_db)):
    await session_mgr.delete_session(session_id, db)
    return {"status": "deleted"}


@app.get("/api/sessions/{session_id}/messages")
async def get_session_messages(session_id: str, limit: int | None = None, db: AsyncSession = Depends(get_db)):
    """Fetch persisted message history for a session."""
    messages = await repo.get_session_messages(db, session_id, limit=limit)
    return [
        {
            "id": f"db-{m.id}",
            "type": m.message_type or "assistant",
            "content": m.content or "",
            "role": m.role,
            "timestamp": m.created_at.isoformat() if m.created_at else "",
            "tool": (m.meta or {}).get("tool"),
            "input": (m.meta or {}).get("input"),
            "status": (m.meta or {}).get("status"),
        }
        for m in messages
    ]


# ──────────────────────────────────────────────
# REST — Run / Cancel (alternative to WebSocket)
# ──────────────────────────────────────────────
@app.post("/api/sessions/{session_id}/run")
async def run_task(session_id: str, req: RunTaskRequest, db: AsyncSession = Depends(get_db)):
    session = await session_mgr.get_session(session_id, db)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if cli_runner.is_running(session_id):
        raise HTTPException(status_code=409, detail="Task already running")

    await session_mgr.update_status(session_id, "running", db)

    # Run in background (result will be streamed via WebSocket)
    async def background_run():
        result = await cli_runner.run_task(
            task=req.task,
            workspace_path=session.workspace_path,
            session_id=session_id,
            max_turns=req.max_turns,
            model=req.model,
        )
        async with async_session_factory() as bg_db:
            new_status = "idle" if result.success else "error"
            await session_mgr.update_status(session_id, new_status, bg_db)

    asyncio.create_task(background_run())
    return {"status": "started", "session_id": session_id}


@app.post("/api/sessions/{session_id}/cancel")
async def cancel_task(session_id: str):
    cancelled = await cli_runner.cancel_task(session_id)
    if cancelled:
        return {"status": "cancelled"}
    raise HTTPException(status_code=404, detail="No running task found")


# ──────────────────────────────────────────────
# REST — Modules
# ──────────────────────────────────────────────
@app.get("/api/modules")
async def list_modules():
    return registry.list_modules()


@app.post("/api/sessions/{session_id}/modules/{module_name}/enable")
async def enable_module(session_id: str, module_name: str, db: AsyncSession = Depends(get_db)):
    module = registry.get_module(module_name)
    if not module:
        raise HTTPException(status_code=404, detail=f"Module '{module_name}' not found")
    await session_mgr.enable_module(session_id, module_name, db)
    return {"status": "enabled", "module": module_name}


@app.post("/api/sessions/{session_id}/modules/{module_name}/disable")
async def disable_module(session_id: str, module_name: str, db: AsyncSession = Depends(get_db)):
    await session_mgr.disable_module(session_id, module_name, db)
    return {"status": "disabled", "module": module_name}


# ──────────────────────────────────────────────
# REST — Files
# ──────────────────────────────────────────────
@app.get("/api/sessions/{session_id}/files")
async def get_files(session_id: str):
    files = session_mgr.get_workspace_files(session_id)
    return files


@app.get("/api/sessions/{session_id}/files/{file_path:path}")
async def read_file(session_id: str, file_path: str):
    content = session_mgr.read_workspace_file(session_id, file_path)
    if content is None:
        raise HTTPException(status_code=404, detail="File not found")
    return {"path": file_path, "content": content}


@app.get("/api/sessions/{session_id}/log")
async def get_log(session_id: str):
    log = session_mgr.get_session_log(session_id)
    return {"log": log}


# ──────────────────────────────────────────────
# REST — Semantic Search
# ──────────────────────────────────────────────
@app.post("/api/search")
async def search_messages(req: SearchRequest, db: AsyncSession = Depends(get_db)):
    results = await repo.semantic_search(
        db, req.query_embedding, limit=req.limit, session_id=req.session_id
    )
    return {"results": results}


# ──────────────────────────────────────────────
# REST — Plugins
# ──────────────────────────────────────────────
@app.get("/api/plugins")
async def list_plugins():
    """List all available plugins (builtin + imported)."""
    return plugin_registry.list_all()


@app.get("/api/plugins/{name}")
async def get_plugin_detail(name: str):
    """Get full plugin details including README."""
    plugin = plugin_registry.get_plugin(name)
    if not plugin:
        raise HTTPException(status_code=404, detail=f"Plugin '{name}' not found")
    return plugin.to_detail_dict()


class ImportPluginRequest(BaseModel):
    source_path: str
    overwrite: bool = False


@app.post("/api/plugins/import")
async def import_plugin(req: ImportPluginRequest):
    """Import a plugin from a local filesystem path (inside container)."""
    try:
        # Check if it already exists before importing if overwrite is False
        import_dir = IMPORTED_PLUGINS_DIR
        plugin_name = os.path.basename(req.source_path.rstrip("/\\"))
        dest_dir = os.path.join(import_dir, plugin_name)
        if not req.overwrite and os.path.exists(dest_dir):
            raise HTTPException(
                status_code=409, 
                detail={"message": f"Plugin '{plugin_name}' already exists.", "requires_confirmation": True}
            )

        info = plugin_registry.import_plugin(req.source_path)
        return {"status": "imported", "plugin": info.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/plugins/upload")
async def upload_plugin(
    files: list[UploadFile] = FastAPIFile(...),
    overwrite: bool = Form(False)
):
    """
    Import a plugin by uploading its folder contents.
    Files must include webkitRelativePath as filename (e.g., 'plugin-name/subdir/file.ext').
    """
    import tempfile

    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    # Determine plugin root name from the first file's relative path
    first_path = files[0].filename or ""
    plugin_root = first_path.split("/")[0] if "/" in first_path else ""
    if not plugin_root:
        raise HTTPException(
            status_code=400,
            detail="Could not determine plugin name from uploaded files"
        )

    # Write files to a temp directory first, then import
    import_dir = IMPORTED_PLUGINS_DIR
    dest_dir = os.path.join(import_dir, plugin_root)

    # Check existing plugin
    if os.path.exists(dest_dir):
        if not overwrite:
            raise HTTPException(
                status_code=409, 
                detail={"message": f"Plugin '{plugin_root}' already exists.", "requires_confirmation": True}
            )
        shutil.rmtree(dest_dir)

    for uploaded_file in files:
        rel_path = uploaded_file.filename or ""
        if not rel_path:
            continue

        # Strip the root folder name to get internal path
        # webkitRelativePath: "plugin-name/subdir/file.ext"
        full_path = os.path.join(import_dir, rel_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)

        content = await uploaded_file.read()
        with open(full_path, "wb") as f:
            f.write(content)

    # Rescan to pick up the new plugin
    plugin_registry.scan_all()

    # Find the imported plugin
    plugin = plugin_registry.get_plugin(plugin_root)
    if plugin:
        return {"status": "imported", "plugin": plugin.to_dict()}
    else:
        return {"status": "imported", "message": f"Files saved to {plugin_root}, but no valid plugin.json found"}


@app.post("/api/plugins/refresh")
async def refresh_plugins():
    """Rescan plugin directories to discover new/removed plugins."""
    plugins = plugin_registry.scan_all()
    return {"status": "refreshed", "count": len(plugins)}


@app.delete("/api/plugins/{name}")
async def delete_plugin(name: str):
    """Delete an imported plugin (cannot delete builtins)."""
    try:
        deleted = plugin_registry.delete_plugin(name)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"Plugin '{name}' not found")
        return {"status": "deleted"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/sessions/{session_id}/plugins")
async def get_session_plugins(session_id: str, db: AsyncSession = Depends(get_db)):
    """List active plugins for a session."""
    session = await session_mgr.get_session(session_id, db)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    active = plugin_registry.get_active_plugins(session.workspace_path)
    return {"active_plugins": active}


@app.post("/api/sessions/{session_id}/plugins/{name}/activate")
async def activate_plugin(session_id: str, name: str, db: AsyncSession = Depends(get_db)):
    """Activate a plugin for a session."""
    session = await session_mgr.get_session(session_id, db)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    success = plugin_registry.activate_for_session(name, session.workspace_path)
    if not success:
        raise HTTPException(status_code=404, detail=f"Plugin '{name}' not found")
    return {"status": "activated", "plugin": name}


@app.post("/api/sessions/{session_id}/plugins/{name}/deactivate")
async def deactivate_plugin(session_id: str, name: str, db: AsyncSession = Depends(get_db)):
    """Deactivate a plugin for a session."""
    session = await session_mgr.get_session(session_id, db)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    plugin_registry.deactivate_for_session(name, session.workspace_path)
    return {"status": "deactivated", "plugin": name}


# ──────────────────────────────────────────────
# Health
# ──────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "modules": len(registry.list_modules()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ──────────────────────────────────────────────
# Preview — serve workspace files with correct MIME type
# ──────────────────────────────────────────────
WORKSPACE_ROOT = os.getenv("WORKSPACE_DIR", "/app/workspaces")


@app.get("/preview/{session_id}/{file_path:path}")
async def preview_file(session_id: str, file_path: str):
    """Serve a workspace file with the correct MIME type for browser preview."""
    workspace = os.path.join(WORKSPACE_ROOT, session_id)
    full_path = os.path.normpath(os.path.join(workspace, file_path))

    # Security: prevent path traversal
    if not full_path.startswith(os.path.normpath(workspace)):
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")

    mime_type, _ = mimetypes.guess_type(full_path)
    return FileResponse(full_path, media_type=mime_type or "application/octet-stream")


# ──────────────────────────────────────────────
# Upload — add files to workspace
# ──────────────────────────────────────────────
@app.post("/api/sessions/{session_id}/upload")
async def upload_file(
    session_id: str,
    file: UploadFile = FastAPIFile(...),
    directory: str = Form(""),
):
    """Upload a file to the workspace. Optional 'directory' for subdirectory."""
    workspace = os.path.join(WORKSPACE_ROOT, session_id)
    if not os.path.isdir(workspace):
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Build target path
    target_dir = os.path.normpath(os.path.join(workspace, directory)) if directory else workspace

    # Security: prevent path traversal
    if not target_dir.startswith(os.path.normpath(workspace)):
        raise HTTPException(status_code=403, detail="Access denied")

    os.makedirs(target_dir, exist_ok=True)
    target_path = os.path.join(target_dir, file.filename or "upload")

    # Write file
    with open(target_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    rel_path = os.path.relpath(target_path, workspace)
    return {
        "status": "uploaded",
        "path": rel_path,
        "size": os.path.getsize(target_path),
    }
