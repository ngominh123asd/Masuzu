"""
Base module interface for MCP server modules.

Each module exposes tools to Claude CLI and injects rules into CLAUDE.md.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolDefinition:
    """Definition of a tool exposed to Claude CLI."""
    name: str
    description: str
    parameters: dict[str, Any] = field(default_factory=dict)


class BaseModule(ABC):
    """
    Abstract base class for agent modules.

    Each module:
    - Has a name and description
    - Exposes tools that Claude CLI can use
    - Provides a CLAUDE.md block with rules/instructions
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique module identifier."""
        ...

    @property
    @abstractmethod
    def display_name(self) -> str:
        """Human-readable module name."""
        ...

    @property
    @abstractmethod
    def description(self) -> str:
        """Module description."""
        ...

    @property
    @abstractmethod
    def tools(self) -> list[ToolDefinition]:
        """List of tools this module exposes."""
        ...

    @abstractmethod
    def get_claude_md_block(self) -> str:
        """
        Return a markdown block to inject into CLAUDE.md when this module is enabled.
        This instructs the agent on how to use the module's tools.
        """
        ...

    def to_dict(self) -> dict:
        """Serialize module info for API responses."""
        return {
            "name": self.name,
            "display_name": self.display_name,
            "description": self.description,
            "tools": [
                {"name": t.name, "description": t.description, "parameters": t.parameters}
                for t in self.tools
            ],
        }
