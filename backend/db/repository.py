"""
Async CRUD operations + pgvector semantic search for long-term memory.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, delete, update, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from .models import SessionRecord, MessageRecord, ToolCallRecord


# ──────────────────────────────────────────────
# Sessions
# ──────────────────────────────────────────────

async def create_session(
    db: AsyncSession,
    session_id: str,
    project_name: str,
    workspace_path: str,
) -> SessionRecord:
    record = SessionRecord(
        id=session_id,
        project_name=project_name,
        workspace_path=workspace_path,
        status="idle",
        active_module_names=[],
    )
    db.add(record)
    await db.flush()
    return record


async def get_session(db: AsyncSession, session_id: str) -> Optional[SessionRecord]:
    result = await db.execute(
        select(SessionRecord).where(SessionRecord.id == session_id)
    )
    return result.scalar_one_or_none()


async def list_sessions(db: AsyncSession) -> list[SessionRecord]:
    result = await db.execute(
        select(SessionRecord).order_by(SessionRecord.last_active.desc())
    )
    return list(result.scalars().all())


async def update_session_status(db: AsyncSession, session_id: str, status: str):
    await db.execute(
        update(SessionRecord)
        .where(SessionRecord.id == session_id)
        .values(status=status, last_active=datetime.now(timezone.utc))
    )
    await db.flush()


async def update_session_modules(db: AsyncSession, session_id: str, modules: list[str]):
    await db.execute(
        update(SessionRecord)
        .where(SessionRecord.id == session_id)
        .values(active_module_names=modules, last_active=datetime.now(timezone.utc))
    )
    await db.flush()


async def delete_session(db: AsyncSession, session_id: str):
    await db.execute(
        delete(SessionRecord).where(SessionRecord.id == session_id)
    )
    await db.flush()


async def reset_running_sessions(db: AsyncSession) -> int:
    """Reset all sessions stuck in 'running' status back to 'idle'.
    Called on backend startup to clean up after crashes."""
    result = await db.execute(
        update(SessionRecord)
        .where(SessionRecord.status == "running")
        .values(status="idle", last_active=datetime.now(timezone.utc))
    )
    await db.flush()
    return result.rowcount


# ──────────────────────────────────────────────
# Messages
# ──────────────────────────────────────────────

async def add_message(
    db: AsyncSession,
    session_id: str,
    role: str,
    content: str,
    message_type: str = "text",
    meta: dict | None = None,
    embedding: list[float] | None = None,
) -> MessageRecord:
    record = MessageRecord(
        session_id=session_id,
        role=role,
        content=content,
        message_type=message_type,
        meta=meta or {},
        embedding=embedding,
    )
    db.add(record)
    await db.flush()
    return record


async def get_session_messages(
    db: AsyncSession, session_id: str, limit: int | None = None
) -> list[MessageRecord]:
    query = (
        select(MessageRecord)
        .where(MessageRecord.session_id == session_id)
        .where(MessageRecord.message_type != "status")
        .order_by(MessageRecord.id.desc())
    )
    if limit is not None:
        query = query.limit(limit)
    
    result = await db.execute(query)
    records = list(result.scalars().all())
    records.reverse()
    return records


# ──────────────────────────────────────────────
# Tool Calls
# ──────────────────────────────────────────────

async def add_tool_call(
    db: AsyncSession,
    message_id: int,
    tool_name: str,
    tool_input: dict | None = None,
    tool_output: str = "",
    status: str = "running",
    duration_ms: int | None = None,
) -> ToolCallRecord:
    record = ToolCallRecord(
        message_id=message_id,
        tool_name=tool_name,
        tool_input=tool_input or {},
        tool_output=tool_output,
        status=status,
        duration_ms=duration_ms,
    )
    db.add(record)
    await db.flush()
    return record


async def update_tool_call_status(
    db: AsyncSession, tool_call_id: int, status: str, output: str = "", duration_ms: int | None = None
):
    values: dict = {"status": status}
    if output:
        values["tool_output"] = output
    if duration_ms is not None:
        values["duration_ms"] = duration_ms
    await db.execute(
        update(ToolCallRecord)
        .where(ToolCallRecord.id == tool_call_id)
        .values(**values)
    )
    await db.flush()


# ──────────────────────────────────────────────
# Semantic Search (pgvector + HNSW)
# ──────────────────────────────────────────────

async def semantic_search(
    db: AsyncSession,
    query_embedding: list[float],
    limit: int = 10,
    session_id: str | None = None,
) -> list[dict]:
    """
    Find messages semantically similar to the query embedding.
    Uses pgvector cosine distance with HNSW index.
    Optionally filter by session_id.
    """
    # Build the query using pgvector's <=> cosine distance operator
    query = (
        select(
            MessageRecord.id,
            MessageRecord.session_id,
            MessageRecord.role,
            MessageRecord.content,
            MessageRecord.message_type,
            MessageRecord.created_at,
            MessageRecord.embedding.cosine_distance(query_embedding).label("distance"),
        )
        .where(MessageRecord.embedding.isnot(None))
        .order_by("distance")
        .limit(limit)
    )

    if session_id:
        query = query.where(MessageRecord.session_id == session_id)

    result = await db.execute(query)
    rows = result.all()

    return [
        {
            "id": row.id,
            "session_id": row.session_id,
            "role": row.role,
            "content": row.content[:500],  # Truncate for preview
            "message_type": row.message_type,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "distance": float(row.distance),
        }
        for row in rows
    ]
