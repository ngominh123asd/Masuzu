"""
SQLAlchemy ORM models — long-term memory layer.

These models persist session history, messages, and tool calls into PostgreSQL.
Message embeddings use pgvector for semantic search across sessions.
Runtime operations still use Claude CLI natively (file-based CLAUDE.md, workspace dirs).
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column, String, Text, Integer, Boolean, DateTime, JSON, ForeignKey, Index, func
)
from sqlalchemy.orm import relationship, Mapped, mapped_column
from pgvector.sqlalchemy import Vector

from .engine import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


class SessionRecord(Base):
    """Persisted session — maps 1:1 to a workspace directory."""
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    project_name: Mapped[str] = mapped_column(String(255), nullable=False)
    workspace_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="idle")  # idle | running | error
    active_module_names: Mapped[dict] = mapped_column(JSON, default=list)  # ["testing", "security"]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_active: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=_utcnow
    )

    # Relationships
    messages: Mapped[list["MessageRecord"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="MessageRecord.created_at"
    )

    def __repr__(self) -> str:
        return f"<Session {self.id} '{self.project_name}' [{self.status}]>"


class MessageRecord(Base):
    """
    A single message in a session — user prompt, assistant reply, tool use, etc.
    The `embedding` column stores a 1536-dim vector for semantic search via pgvector.
    """
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(32), ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user | assistant | tool | system
    content: Mapped[str] = mapped_column(Text, default="")
    message_type: Mapped[str] = mapped_column(String(30), default="text")
    # text | tool_use | tool_result | thinking | error | status
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    # Stores: tool_name, tool_id, status badge, turn number, token counts, etc.
    embedding = Column(Vector(1536), nullable=True)
    # pgvector column — populated async after message is saved
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    session: Mapped["SessionRecord"] = relationship(back_populates="messages")
    tool_calls: Mapped[list["ToolCallRecord"]] = relationship(
        back_populates="message", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Message #{self.id} [{self.role}/{self.message_type}]>"


# HNSW index for fast vector similarity search
Index(
    "idx_messages_embedding_hnsw",
    MessageRecord.embedding,
    postgresql_using="hnsw",
    postgresql_with={"m": 16, "ef_construction": 64},
    postgresql_ops={"embedding": "vector_cosine_ops"},
)


class ToolCallRecord(Base):
    """Persisted tool call — bash, read_file, write_file, edit_file, etc."""
    __tablename__ = "tool_calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    message_id: Mapped[int] = mapped_column(Integer, ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    tool_name: Mapped[str] = mapped_column(String(64), nullable=False)
    tool_input: Mapped[dict] = mapped_column(JSON, default=dict)
    tool_output: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="running")  # running | success | error
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    message: Mapped["MessageRecord"] = relationship(back_populates="tool_calls")

    def __repr__(self) -> str:
        return f"<ToolCall #{self.id} [{self.tool_name}] {self.status}>"
