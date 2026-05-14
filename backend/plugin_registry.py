"""
Plugin Registry — discover, import, and manage Claude CLI plugins.

Scans builtin plugins (from claude-code/plugins/) and user-imported plugins (from plugins/).
Activates/deactivates plugins per-session by copying into workspace .claude/plugins/.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Directories (set via env or defaults)
BUILTIN_PLUGINS_DIR = os.getenv("BUILTIN_PLUGINS_DIR", os.path.join(os.path.dirname(__file__), "..", "claude-code", "plugins"))
IMPORTED_PLUGINS_DIR = os.getenv("IMPORTED_PLUGINS_DIR", os.path.join(os.path.dirname(__file__), "..", "plugins"))


@dataclass
class PluginInfo:
    """Parsed plugin metadata from .claude-plugin/plugin.json."""
    name: str
    description: str = ""
    version: str = "1.0.0"
    author: str = ""
    category: str = "general"
    source_path: str = ""
    is_builtin: bool = False
    # Auto-discovered contents
    commands: list[str] = field(default_factory=list)
    agents: list[str] = field(default_factory=list)
    skills: list[str] = field(default_factory=list)
    hooks: list[str] = field(default_factory=list)
    has_mcp: bool = False
    readme: str = ""

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "author": self.author,
            "category": self.category,
            "is_builtin": self.is_builtin,
            "commands": self.commands,
            "agents": self.agents,
            "skills": self.skills,
            "hooks": self.hooks,
            "has_mcp": self.has_mcp,
        }

    def to_detail_dict(self) -> dict:
        """Full details including README."""
        d = self.to_dict()
        d["readme"] = self.readme
        return d


def _scan_plugin_dir(plugin_path: str) -> Optional[PluginInfo]:
    """Parse a single plugin directory and return PluginInfo, or None if invalid."""
    plugin_json_path = os.path.join(plugin_path, ".claude-plugin", "plugin.json")
    if not os.path.isfile(plugin_json_path):
        return None

    try:
        with open(plugin_json_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"Failed to parse plugin.json at {plugin_json_path}: {e}")
        return None

    # Extract author
    author = meta.get("author", "")
    if isinstance(author, dict):
        author = author.get("name", "")

    info = PluginInfo(
        name=meta.get("name", os.path.basename(plugin_path)),
        description=meta.get("description", ""),
        version=meta.get("version", "1.0.0"),
        author=author,
        category=meta.get("category", "general"),
        source_path=os.path.abspath(plugin_path),
    )

    # Auto-discover contents
    explicit_commands = meta.get("commands", {}) if meta else {}
    for subdir, target_list in [
        ("commands", info.commands),
        ("agents", info.agents),
        ("skills", info.skills),
        ("hooks", info.hooks),
    ]:
        subdir_path = os.path.join(plugin_path, subdir)
        if os.path.isdir(subdir_path):
            for fname in sorted(os.listdir(subdir_path)):
                if fname.startswith("."):
                    continue
                # Strip extension for display
                name = os.path.splitext(fname)[0]
                
                # Check for explicit mapping
                if subdir == "commands" and name in explicit_commands:
                    target_list.append(explicit_commands[name])
                else:
                    target_list.append(name)

    # Check for MCP config
    info.has_mcp = os.path.isfile(os.path.join(plugin_path, ".mcp.json"))

    # Read README if available
    for readme_name in ("README.md", "readme.md", "README.txt"):
        readme_path = os.path.join(plugin_path, readme_name)
        if os.path.isfile(readme_path):
            try:
                with open(readme_path, "r", encoding="utf-8", errors="replace") as f:
                    info.readme = f.read()
            except OSError:
                pass
            break

    return info


class PluginRegistry:
    """
    Central registry for Claude CLI plugins.
    Discovers builtin and imported plugins, manages per-session activation.
    """

    def __init__(self):
        self._plugins: dict[str, PluginInfo] = {}

    def scan_all(self) -> dict[str, PluginInfo]:
        """Scan builtin and imported plugin directories."""
        self._plugins.clear()

        # Scan builtin plugins
        if os.path.isdir(BUILTIN_PLUGINS_DIR):
            for entry in sorted(os.listdir(BUILTIN_PLUGINS_DIR)):
                path = os.path.join(BUILTIN_PLUGINS_DIR, entry)
                if not os.path.isdir(path):
                    continue
                info = _scan_plugin_dir(path)
                if info:
                    info.is_builtin = True
                    self._plugins[info.name] = info
                    logger.info(f"Discovered builtin plugin: {info.name}")

        # Scan imported plugins
        os.makedirs(IMPORTED_PLUGINS_DIR, exist_ok=True)
        if os.path.isdir(IMPORTED_PLUGINS_DIR):
            for entry in sorted(os.listdir(IMPORTED_PLUGINS_DIR)):
                path = os.path.join(IMPORTED_PLUGINS_DIR, entry)
                if not os.path.isdir(path):
                    continue
                info = _scan_plugin_dir(path)
                if info:
                    info.is_builtin = False
                    self._plugins[info.name] = info
                    logger.info(f"Discovered imported plugin: {info.name}")

        return self._plugins

    def list_all(self) -> list[dict]:
        """List all plugins as dicts."""
        return [p.to_dict() for p in self._plugins.values()]

    def get_plugin(self, name: str) -> Optional[PluginInfo]:
        """Get a plugin by name."""
        return self._plugins.get(name)

    def import_plugin(self, source_path: str) -> PluginInfo:
        """
        Import a plugin from a local filesystem path.
        Copies the plugin directory into IMPORTED_PLUGINS_DIR.
        Raises ValueError if the source is invalid.
        """
        source_path = os.path.abspath(source_path)

        if not os.path.isdir(source_path):
            raise ValueError(f"Source path does not exist: {source_path}")

        # Validate: must have .claude-plugin/plugin.json
        info = _scan_plugin_dir(source_path)
        if not info:
            raise ValueError(
                f"Invalid plugin: {source_path} — must contain .claude-plugin/plugin.json"
            )

        # Check for name collision with builtin
        existing = self._plugins.get(info.name)
        if existing and existing.is_builtin:
            raise ValueError(
                f"Cannot import plugin '{info.name}': conflicts with builtin plugin"
            )

        # Copy to imported plugins directory
        dest = os.path.join(IMPORTED_PLUGINS_DIR, info.name)
        if os.path.exists(dest):
            shutil.rmtree(dest)
        shutil.copytree(source_path, dest)

        # Re-scan the imported copy
        imported = _scan_plugin_dir(dest)
        if imported:
            imported.is_builtin = False
            self._plugins[imported.name] = imported
            logger.info(f"Imported plugin: {imported.name} from {source_path}")
            return imported

        raise ValueError("Failed to import plugin")

    def delete_plugin(self, name: str) -> bool:
        """Delete an imported plugin. Cannot delete builtins."""
        plugin = self._plugins.get(name)
        if not plugin:
            return False
        if plugin.is_builtin:
            raise ValueError(f"Cannot delete builtin plugin: {name}")

        # Remove from disk
        dest = os.path.join(IMPORTED_PLUGINS_DIR, name)
        if os.path.exists(dest):
            shutil.rmtree(dest)

        self._plugins.pop(name, None)
        logger.info(f"Deleted imported plugin: {name}")
        return True

    def activate_for_session(self, plugin_name: str, workspace_path: str) -> bool:
        """
        Activate a plugin for a session by copying it into the workspace's
        .claude/plugins/ directory (Claude CLI auto-discovers plugins there).
        """
        plugin = self._plugins.get(plugin_name)
        if not plugin:
            return False

        plugins_dir = os.path.join(workspace_path, ".claude", "plugins")
        os.makedirs(plugins_dir, exist_ok=True)

        dest = os.path.join(plugins_dir, plugin_name)
        if os.path.exists(dest):
            shutil.rmtree(dest)

        shutil.copytree(plugin.source_path, dest)
        logger.info(f"Activated plugin '{plugin_name}' for workspace: {workspace_path}")
        return True

    def deactivate_for_session(self, plugin_name: str, workspace_path: str) -> bool:
        """Remove a plugin from the workspace's .claude/plugins/ directory."""
        dest = os.path.join(workspace_path, ".claude", "plugins", plugin_name)
        if os.path.exists(dest):
            shutil.rmtree(dest)
            logger.info(f"Deactivated plugin '{plugin_name}' from workspace: {workspace_path}")
            return True
        return False

    def get_active_plugins(self, workspace_path: str) -> list[str]:
        """List plugin names currently active in a workspace."""
        plugins_dir = os.path.join(workspace_path, ".claude", "plugins")
        if not os.path.isdir(plugins_dir):
            return []
        active = []
        for entry in sorted(os.listdir(plugins_dir)):
            path = os.path.join(plugins_dir, entry)
            if os.path.isdir(path) and os.path.isfile(
                os.path.join(path, ".claude-plugin", "plugin.json")
            ):
                active.append(entry)
        return active


# Global singleton
plugin_registry = PluginRegistry()
