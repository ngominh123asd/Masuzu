"""
Module Registry — load, register, enable/disable MCP modules.
"""
from __future__ import annotations

import logging
from typing import Optional

from modules.base_module import BaseModule
from modules.testing_module import TestingModule
from modules.security_module import SecurityModule
from modules.devops_module import DevOpsModule

logger = logging.getLogger(__name__)


class ModuleRegistry:
    """
    Central registry for all available modules.
    Modules are loaded at startup; enable/disable is per-session.
    """

    def __init__(self):
        self._modules: dict[str, BaseModule] = {}

    def load_all_modules(self) -> dict[str, BaseModule]:
        """Load and register all built-in modules."""
        builtins = [
            TestingModule(),
            SecurityModule(),
            DevOpsModule(),
        ]
        for module in builtins:
            self._modules[module.name] = module
            logger.info(f"Registered module: {module.name} ({module.display_name})")

        return self._modules

    def get_module(self, name: str) -> Optional[BaseModule]:
        """Get a module by name."""
        return self._modules.get(name)

    def list_modules(self) -> list[dict]:
        """List all registered modules."""
        return [mod.to_dict() for mod in self._modules.values()]

    def get_claude_md_blocks(self, module_names: list[str]) -> str:
        """Merge CLAUDE.md blocks for a list of enabled modules."""
        blocks = []
        for name in module_names:
            module = self._modules.get(name)
            if module:
                block = module.get_claude_md_block()
                if block:
                    blocks.append(block)
        return "\n\n".join(blocks)


# Global singleton
registry = ModuleRegistry()
