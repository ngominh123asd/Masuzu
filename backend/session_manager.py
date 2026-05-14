"""
Session Manager — manages sessions, workspaces, and CLAUDE.md generation.

Uses file-based approach for active operations (native Claude CLI),
with background persistence to PostgreSQL for long-term memory.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from db import repository as repo

logger = logging.getLogger(__name__)

WORKSPACES_DIR = os.getenv("WORKSPACES_DIR", os.path.join(os.path.dirname(__file__), "..", "workspaces"))

# Base CLAUDE.md template — injected into every workspace
CLAUDE_MD_BASE = """# Agent Rules

## Quy tắc bắt buộc
- BẮT BUỘC: Trước khi tạo bất kỳ file code nào cho dự án, bạn PHẢI tạo một thư mục dự án (với tên liên quan đến dự án) và di chuyển vào đó hoặc tạo file bên trong thư mục đó. KHÔNG tạo file lung tung ở thư mục gốc.
- KHÔNG BAO GIỜ tạo các file placeholder/ví dụ (như a.txt, b.txt, c.txt, test1.py, example.js...) trừ khi người dùng yêu cầu CHÍNH XÁC tên file đó.
- Khi người dùng yêu cầu "3 file riêng" cho web, đó nghĩa là: index.html, style.css, script.js — KHÔNG PHẢI a.txt, b.txt, c.txt.
- Chỉ tạo file khi nó thực sự cần thiết cho project
- Nếu test fail, đọc lỗi, tự sửa, chạy lại — không hỏi người dùng
- Không được coi task là xong nếu còn lỗi chưa giải quyết
- Với mỗi file mới, kiểm tra lint trước khi kết thúc

## Workflow chuẩn
1. Đọc yêu cầu và phân tích
2. Kiểm tra cấu trúc project hiện tại bằng Bash (ls, find, cat)
3. Tạo thư mục dự án (nếu chưa có) và tiến hành tạo/sửa file bên trong
4. Xác minh kết quả (chạy code/test nếu cần)
5. Báo cáo kết quả cuối cùng

{MODULE_BLOCKS}
"""


@dataclass
class Session:
    """In-memory session representation."""
    id: str
    project_name: str
    workspace_path: str
    active_modules: list[str] = field(default_factory=list)
    status: str = "idle"  # idle | running | error
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_active: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class SessionManager:
    """
    Manages sessions and workspaces.
    File-based for runtime (CLAUDE.md, session.log), DB for long-term storage.
    """

    def __init__(self):
        self._sessions: dict[str, Session] = {}
        self._workspaces_dir = os.path.abspath(WORKSPACES_DIR)
        os.makedirs(self._workspaces_dir, exist_ok=True)

    async def create_session(
        self, project_name: str, db: AsyncSession
    ) -> Session:
        """Create a new session with a workspace directory."""
        session_id = uuid.uuid4().hex[:12]
        workspace_path = os.path.join(self._workspaces_dir, session_id)
        os.makedirs(workspace_path, exist_ok=True)

        session = Session(
            id=session_id,
            project_name=project_name,
            workspace_path=workspace_path,
        )
        self._sessions[session_id] = session

        # Write initial CLAUDE.md
        self._write_claude_md(session)

        # Persist to DB
        await repo.create_session(db, session_id, project_name, workspace_path)
        await db.commit()

        logger.info(f"Created session {session_id} for project '{project_name}'")
        return session

    async def get_session(self, session_id: str, db: AsyncSession) -> Optional[Session]:
        """Get session from memory, falling back to DB."""
        if session_id in self._sessions:
            return self._sessions[session_id]

        # Try loading from DB
        record = await repo.get_session(db, session_id)
        if record:
            session = Session(
                id=record.id,
                project_name=record.project_name,
                workspace_path=record.workspace_path,
                active_modules=record.active_module_names or [],
                status=record.status,
                created_at=record.created_at,
                last_active=record.last_active,
            )
            self._sessions[session_id] = session
            return session

        return None

    async def list_sessions(self, db: AsyncSession) -> list[Session]:
        """List all sessions."""
        records = await repo.list_sessions(db)
        sessions = []
        for rec in records:
            session = Session(
                id=rec.id,
                project_name=rec.project_name,
                workspace_path=rec.workspace_path,
                active_modules=rec.active_module_names or [],
                status=rec.status,
                created_at=rec.created_at,
                last_active=rec.last_active,
            )
            self._sessions[rec.id] = session
            sessions.append(session)
        return sessions

    async def delete_session(self, session_id: str, db: AsyncSession):
        """Delete session and clean up workspace."""
        session = self._sessions.pop(session_id, None)
        workspace_path = session.workspace_path if session else os.path.join(self._workspaces_dir, session_id)

        # Remove workspace directory
        if os.path.exists(workspace_path):
            shutil.rmtree(workspace_path, ignore_errors=True)
            logger.info(f"Removed workspace {workspace_path}")

        # Remove from DB
        await repo.delete_session(db, session_id)
        await db.commit()

    async def update_status(self, session_id: str, status: str, db: AsyncSession):
        """Update session status."""
        session = self._sessions.get(session_id)
        if session:
            session.status = status
            session.last_active = datetime.now(timezone.utc)

        await repo.update_session_status(db, session_id, status)
        await db.commit()

    async def enable_module(self, session_id: str, module_name: str, db: AsyncSession):
        """Enable a module for a session."""
        session = self._sessions.get(session_id)
        if session and module_name not in session.active_modules:
            session.active_modules.append(module_name)
            self._write_claude_md(session)
            await repo.update_session_modules(db, session_id, session.active_modules)
            await db.commit()

    async def disable_module(self, session_id: str, module_name: str, db: AsyncSession):
        """Disable a module for a session."""
        session = self._sessions.get(session_id)
        if session and module_name in session.active_modules:
            session.active_modules.remove(module_name)
            self._write_claude_md(session)
            await repo.update_session_modules(db, session_id, session.active_modules)
            await db.commit()

    def get_workspace_files(self, session_id: str) -> list[dict]:
        """Get file tree of a workspace — fast pruned walk."""
        session = self._sessions.get(session_id)
        if not session:
            return []

        SKIP = {".git", "__pycache__", "node_modules", ".next", ".venv", "venv", "dist", ".cache"}
        # Directories starting with '.' that we DO want to show
        DOTDIR_ALLOW = {".claude"}
        files = []
        workspace = session.workspace_path

        for dirpath, dirnames, filenames in os.walk(workspace):
            # Prune: modify dirnames IN-PLACE so os.walk won't enter them
            dirnames[:] = sorted([
                d for d in dirnames
                if d not in SKIP and (not d.startswith(".") or d in DOTDIR_ALLOW)
            ])

            rel_dir = os.path.relpath(dirpath, workspace)
            if rel_dir == ".":
                rel_dir = ""

            # Add subdirectories
            for d in dirnames:
                rel_path = f"{rel_dir}/{d}" if rel_dir else d
                files.append({
                    "path": rel_path.replace("\\", "/"),
                    "name": d,
                    "is_dir": True,
                    "size": 0,
                })

            # Add files
            for f in sorted(filenames):
                if f.startswith("."):
                    continue
                rel_path = f"{rel_dir}/{f}" if rel_dir else f
                full = os.path.join(dirpath, f)
                try:
                    size = os.path.getsize(full)
                except OSError:
                    size = 0
                files.append({
                    "path": rel_path.replace("\\", "/"),
                    "name": f,
                    "is_dir": False,
                    "size": size,
                })
        return files

    def read_workspace_file(self, session_id: str, file_path: str) -> Optional[str]:
        """Read a file from the workspace.
        
        Handles Docker-internal absolute paths (e.g. /home/agent/.claude/plans/xxx.md)
        by falling back to basename search within the workspace.
        """
        session = self._sessions.get(session_id)
        if not session:
            return None

        workspace = session.workspace_path

        # Try direct relative path first
        full_path = os.path.join(workspace, file_path)
        if os.path.abspath(full_path).startswith(os.path.abspath(workspace)) and os.path.isfile(full_path):
            try:
                with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                    return f.read()
            except Exception:
                return None

        # Fallback 1: Strip Docker-internal prefixes and retry
        stripped = file_path
        for prefix in ("/home/agent/", "/app/", "/workspace/"):
            if file_path.startswith(prefix):
                stripped = file_path[len(prefix):]
                break
        if stripped.startswith("/"):
            stripped = stripped.lstrip("/")

        if stripped != file_path:
            full_path = os.path.join(workspace, stripped)
            if os.path.abspath(full_path).startswith(os.path.abspath(workspace)) and os.path.isfile(full_path):
                try:
                    with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                        return f.read()
                except Exception:
                    return None

        # Fallback 2: Search .claude/plans/ directory (common for agent plan files)
        basename = os.path.basename(file_path)
        claude_plans = os.path.join(workspace, ".claude", "plans", basename)
        if os.path.isfile(claude_plans):
            try:
                with open(claude_plans, "r", encoding="utf-8", errors="replace") as f:
                    return f.read()
            except Exception:
                return None

        # Fallback 3: Search by basename recursively in workspace (max depth 3)
        if basename:
            for dirpath, dirnames, filenames in os.walk(workspace):
                depth = dirpath.replace(workspace, "").count(os.sep)
                if depth > 3:
                    dirnames.clear()
                    continue
                if basename in filenames:
                    found = os.path.join(dirpath, basename)
                    try:
                        with open(found, "r", encoding="utf-8", errors="replace") as f:
                            return f.read()
                    except Exception:
                        return None

        return None

    def get_session_log(self, session_id: str) -> str:
        """Read session.log from workspace."""
        session = self._sessions.get(session_id)
        if not session:
            return ""
        log_path = os.path.join(session.workspace_path, "session.log")
        if os.path.isfile(log_path):
            with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                return f.read()
        return ""

    def _write_claude_md(self, session: Session):
        """Generate and write CLAUDE.md from base template + active module blocks."""
        from module_registry import registry

        module_blocks = []
        for mod_name in session.active_modules:
            module = registry.get_module(mod_name)
            if module:
                block = module.get_claude_md_block()
                if block:
                    module_blocks.append(block)

        blocks_text = "\n\n".join(module_blocks) if module_blocks else ""
        content = CLAUDE_MD_BASE.replace("{MODULE_BLOCKS}", blocks_text)

        claude_md_path = os.path.join(session.workspace_path, "CLAUDE.md")
        with open(claude_md_path, "w", encoding="utf-8") as f:
            f.write(content)

    def append_session_log(self, session_id: str, line: str):
        """Append a line to session.log."""
        session = self._sessions.get(session_id)
        if not session:
            return
        log_path = os.path.join(session.workspace_path, "session.log")
        with open(log_path, "a", encoding="utf-8") as f:
            ts = datetime.now(timezone.utc).isoformat()
            f.write(f"[{ts}] {line}\n")
