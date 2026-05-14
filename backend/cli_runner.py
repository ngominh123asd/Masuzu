"""
CLI Runner — spawn and manage Claude Code CLI subprocess.

Runs claude CLI as an asyncio subprocess with:
- ANTHROPIC_BASE_URL pointing to the free-claude-code proxy
- --dangerously-skip-permissions (no confirmation prompts)
- --output-format stream-json (parse-friendly output)
- --max-turns configurable

Streams stdout line-by-line to the frontend via WebSocket callback.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine, Optional

logger = logging.getLogger(__name__)


@dataclass
class TaskResult:
    """Result of a completed CLI task."""
    session_id: str
    success: bool = False
    output_lines: list[str] = field(default_factory=list)
    error: str | None = None
    turns_used: int = 0
    model_name: str | None = None  # Track requested model name for display
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    finished_at: datetime | None = None


class CLIRunner:
    """
    Spawn and manage claude CLI subprocess.
    Each instance manages one running task at a time.
    Tracks claude-code session IDs for conversation continuity.
    """

    # Model name mapping — map short names to full provider/model paths
    # Must match proxy settings: MODEL_HAIKU, MODEL_SONNET, MODEL_OPUS
    MODEL_MAPPING = {
        "haiku": "nvidia_nim/gemini/gemini-3.1-flash-lite-preview",
        "sonnet": "nvidia_nim/gemini/gemini-3-flash-preview",
        "opus": "nvidia_nim/gemini/gemini-3.1-pro-preview",
    }

    def __init__(self):
        self._processes: dict[str, asyncio.subprocess.Process] = {}

    def _resolve_model_name(self, model: str | None) -> str | None:
        """
        Resolve short model name (haiku/sonnet/opus) to full provider/model path.
        If model is already a full path or None, return as-is.
        """
        if not model:
            return None
        
        # If it's a known short name, map it
        if model.lower() in self.MODEL_MAPPING:
            return self.MODEL_MAPPING[model.lower()]
        
        # Otherwise assume it's already a full path
        return model

    async def run_task(
        self,
        task: str,
        workspace_path: str,
        session_id: str,
        max_turns: int = 50,
        on_output: Optional[Callable[[dict], Coroutine]] = None,
        model: str | None = None,
    ) -> TaskResult:
        """
        Spawn claude CLI subprocess and stream output.

        Args:
            task: The prompt/task to send to Claude
            workspace_path: Working directory for the CLI
            session_id: Session identifier
            max_turns: Maximum agentic turns
            on_output: Async callback for each output event
            model: Optional model override
        """
        result = TaskResult(session_id=session_id)

        # Resolve model name to full provider/model path
        resolved_model = self._resolve_model_name(model)
        
        # Track the requested model name for display in result
        result.model_name = resolved_model or model

        # Environment variables for the proxy
        env = os.environ.copy()
        env["ANTHROPIC_BASE_URL"] = os.getenv("ANTHROPIC_BASE_URL", "http://localhost:8082")
        auth_token = os.getenv("ANTHROPIC_AUTH_TOKEN", "freecc")
        if model:
            auth_token = f"{auth_token}:{model}"
        env["ANTHROPIC_AUTH_TOKEN"] = auth_token
        env["CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY"] = "1"

        # Build command
        cmd = [
            "claude",
            "--print", task,
            "--dangerously-skip-permissions",
            "--output-format", "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--max-turns", str(max_turns),
            "--disallowedTools", "AskUserQuestion",  # Can't answer interactively in --print mode
        ]

        if resolved_model:
            cmd.extend(["--model", resolved_model])

        logger.info(f"[{session_id}] Starting CLI: {' '.join(cmd[:6])}...")
        logger.info(f"[{session_id}] Workspace: {workspace_path}")
        if model:
            logger.info(f"[{session_id}] Model: {model} → {resolved_model}")

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=workspace_path,
                env=env,
                limit=16 * 1024 * 1024,  # 16MB buffer — claude-code can emit very long JSON lines
            )

            self._processes[session_id] = process

            # Notify start
            if on_output:
                await on_output({
                    "type": "status",
                    "content": "running",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

            # Stream stdout line-by-line
            turns = 0
            accumulated_text = ""  # Track ALL text we've emitted to detect duplicates
            has_streamed_tokens = False  # True when we've sent token events for current response
            assert process.stdout is not None
            async for line_bytes in process.stdout:
                line = line_bytes.decode("utf-8", errors="replace").strip()
                if not line:
                    continue

                result.output_lines.append(line)

                # Try to parse mixed JSON and text (due to claude-code bug)
                # Returns (list_of_events, trailing_text, was_parsed_successfully)
                events, trailing_text, parsed = self._parse_mixed_line(line, result)
                
                # Stream trailing raw text as token (for streaming effect)
                if trailing_text:
                    accumulated_text += trailing_text
                    has_streamed_tokens = True
                    if on_output:
                        await on_output({
                            "type": "token",
                            "content": trailing_text,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        })

                for event in events:
                    event_type = event.get("type", "")

                    if event_type == "tool_use":
                        turns += 1
                        has_streamed_tokens = False  # Reset for next response cycle

                    # Track token content so we can detect duplicates
                    if event_type == "token":
                        accumulated_text += str(event.get("content", ""))
                        has_streamed_tokens = True

                    # Suppress duplicate assistant message from WebSocket if already streamed tokens,
                    # but still persist to DB via _db_only flag
                    if event_type == "assistant" and has_streamed_tokens:
                        has_streamed_tokens = False  # Reset for next cycle
                        event["_db_only"] = True  # Save to DB but don't send via WebSocket
                    elif event_type == "assistant":
                        event_content = str(event.get("content", "")).strip()
                        if event_content and accumulated_text and event_content in accumulated_text:
                            event["_db_only"] = True  # Fallback dedup — still save to DB
                        elif event_content:
                            accumulated_text += event_content

                    if on_output:
                        await on_output(event)
                
                # Only fallback to raw text if parsing completely failed
                if not parsed and not events and not trailing_text:
                    if on_output:
                        await on_output({
                            "type": "assistant",
                            "content": line,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        })

            # Wait for process to finish
            await process.wait()

            # Read stderr
            assert process.stderr is not None
            stderr = await process.stderr.read()
            stderr_text = stderr.decode("utf-8", errors="replace").strip()

            if process.returncode == 0:
                result.success = True
            else:
                result.success = False
                result.error = stderr_text or f"Process exited with code {process.returncode}"
                logger.warning(f"[{session_id}] CLI exited with code {process.returncode}: {stderr_text[:200]}")

            result.turns_used = turns

        except asyncio.CancelledError:
            result.success = False
            result.error = "Task cancelled"
            logger.info(f"[{session_id}] Task cancelled")

        except Exception as e:
            result.success = False
            result.error = str(e)
            logger.exception(f"[{session_id}] CLI runner error")

        finally:
            result.finished_at = datetime.now(timezone.utc)
            self._processes.pop(session_id, None)

            # Notify completion
            if on_output:
                await on_output({
                    "type": "result" if result.success else "error",
                    "content": result.error or "Task completed successfully",
                    "turns": result.turns_used,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

        return result

    async def cancel_task(self, session_id: str) -> bool:
        """Cancel a running task by sending SIGTERM to the subprocess."""
        process = self._processes.get(session_id)
        if process and process.returncode is None:
            logger.info(f"[{session_id}] Cancelling task (SIGTERM)")
            try:
                # On Windows use terminate(), on Unix use SIGTERM
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    process.kill()
                    await process.wait()
                return True
            except ProcessLookupError:
                return False
        return False

    def is_running(self, session_id: str) -> bool:
        """Check if a task is currently running for a session."""
        process = self._processes.get(session_id)
        return process is not None and process.returncode is None

    def _parse_mixed_line(self, line: str, result=None) -> tuple[list[dict], str, bool]:
        """
        Extract JSON object and any trailing raw text from a line.
        Returns (parsed_events, trailing_text, was_parsed).
        was_parsed=True means JSON was valid (even if event list is empty).
        """
        json_part = ""
        trailing_text = ""
        
        if line.startswith("{"):
            depth = 0
            in_string = False
            escape_next = False
            for i, char in enumerate(line):
                if escape_next:
                    escape_next = False
                    continue
                if char == '\\' and in_string:
                    escape_next = True
                    continue
                if char == '"' and not escape_next:
                    in_string = not in_string
                    continue
                if in_string:
                    continue
                if char == '{':
                    depth += 1
                elif char == '}':
                    depth -= 1
                    if depth == 0:
                        json_part = line[:i+1]
                        trailing_text = line[i+1:]
                        break
        
        if not json_part:
            json_part = line

        try:
            data = json.loads(json_part)
            if isinstance(data, dict):
                event_type = data.get("type", "")
                events = []

                # ── Handle stream_event types (realtime UI updates) ──
                if event_type == "stream_event":
                    stream_data = data.get("event", {})
                    s_type = stream_data.get("type")
                    if s_type == "content_block_start":
                        block = stream_data.get("content_block", {})
                        if block.get("type") == "tool_use":
                            events.append({
                                "type": "tool_start",
                                "tool": block.get("name"),
                                "tool_use_id": block.get("id"),
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                            })
                    elif s_type == "content_block_delta":
                        delta = stream_data.get("delta", {})
                        if delta.get("type") == "input_json_delta":
                            events.append({
                                "type": "tool_stream",
                                "content": delta.get("partial_json", ""),
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                            })
                        elif delta.get("type") == "text_delta":
                            events.append({
                                "type": "token",
                                "content": delta.get("text", ""),
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                            })
                    return events, trailing_text, True

                # ── Handle result event: extract metadata only, skip duplicate text ──
                if event_type == "result":
                    parts = []
                    duration = data.get("duration_ms")
                    if duration:
                        parts.append(f"{duration}ms")
                    cost = data.get("total_cost_usd")
                    if cost:
                        parts.append(f"${cost:.6f}")
                    usage = data.get("usage", {})
                    in_tok = usage.get("input_tokens")
                    out_tok = usage.get("output_tokens")
                    if in_tok or out_tok:
                        parts.append(f"in:{in_tok} out:{out_tok}")
                    # Use tracked model_name instead of modelUsage from response
                    if result and result.model_name:
                        short_model = result.model_name.split("/")[-1]
                        parts.append(f"model:{short_model}")
                    
                    summary = " · ".join(parts) if parts else "completed"
                    
                    event: dict[str, Any] = {
                        "type": "result",
                        "content": summary,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }
                    for key in ("subtype", "error", "status"):
                        if key in data:
                            event[key] = data[key]
                    events.append(event)
                    return events, trailing_text, True

                # ── Handle assistant event: extract text AND tool_use from message ──
                if event_type == "assistant" and "message" in data:
                    msg = data["message"]
                    if isinstance(msg, dict):
                        content_arr = msg.get("content", [])
                        if isinstance(content_arr, list):
                            for block in content_arr:
                                if block.get("type") == "text":
                                    text = block.get("text", "")
                                    if text:
                                        events.append({
                                            "type": "assistant",
                                            "content": text,
                                            "timestamp": datetime.now(timezone.utc).isoformat(),
                                        })
                                elif block.get("type") == "tool_use":
                                    events.append({
                                        "type": "tool_use",
                                        "tool": block.get("name"),
                                        "tool_use_id": block.get("id"),
                                        "input": block.get("input", {}),
                                        "content": json.dumps(block.get("input", {}), ensure_ascii=False),
                                        "timestamp": datetime.now(timezone.utc).isoformat(),
                                    })
                    return events, trailing_text, True

                # ── Handle user event: extract tool_result from message ──
                if event_type == "user" and isinstance(data.get("content"), list):
                    for block in data["content"]:
                        if block.get("type") == "tool_result":
                            events.append({
                                "type": "tool_result",
                                "tool_use_id": block.get("tool_use_id"),
                                "content": str(block.get("content", "")),
                                "status": "error" if block.get("is_error") else "success",
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                            })
                    if events:
                        return events, trailing_text, True

                # ── Handle system/status events ──
                event = {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                event["type"] = event_type or "assistant"

                if "tool" in data:
                    event["tool"] = data["tool"]

                for key in ("content", "text", "message", "output", "result"):
                    if key in data:
                        event["content"] = str(data[key])
                        break
                else:
                    event["content"] = json.dumps(data, ensure_ascii=False)

                for key in ("tool_use_id", "input", "status", "error", "subtype"):
                    if key in data:
                        event[key] = data[key]

                events.append(event)
                return events, trailing_text, True
        except (json.JSONDecodeError, TypeError):
            return [], line, False
        
        return [], line, False

    def _parse_stream_line(self, line: str) -> dict | None:
        """
        Parse a line from --output-format stream-json.

        Each line is a JSON object with fields like:
        - type: "assistant", "tool_use", "tool_result", "result", "error"
        - tool: tool name (for tool_use/tool_result)
        - content: text content
        """
        try:
            data = json.loads(line)
            if isinstance(data, dict):
                # Handle token streams
                if data.get("type") == "stream_event":
                    event_data = data.get("event", {})
                    if event_data.get("type") == "content_block_delta":
                        delta = event_data.get("delta", {})
                        if delta.get("type") == "text_delta":
                            return {
                                "type": "token",
                                "content": delta.get("text", ""),
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                            }
                    # We can ignore other stream_events like message_start/stop to prevent clutter
                    return None

                # Normalize the event
                event: dict[str, Any] = {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }

                # Map stream-json fields
                if "type" in data:
                    event["type"] = data["type"]
                else:
                    event["type"] = "assistant"

                if "tool" in data:
                    event["tool"] = data["tool"]

                # Content can be in various fields
                for key in ("content", "text", "message", "output", "result"):
                    if key in data:
                        # Sometimes message is an object with content array
                        if key == "message" and isinstance(data[key], dict):
                            content_arr = data[key].get("content", [])
                            if isinstance(content_arr, list) and len(content_arr) > 0:
                                event["content"] = content_arr[0].get("text", "")
                            else:
                                event["content"] = json.dumps(data[key], ensure_ascii=False)
                        else:
                            event["content"] = str(data[key])
                        break
                else:
                    event["content"] = json.dumps(data, ensure_ascii=False)

                # Pass through extra metadata
                for key in ("tool_use_id", "input", "status", "error", "subtype"):
                    if key in data:
                        event[key] = data[key]

                return event
        except (json.JSONDecodeError, TypeError):
            return None
        return None
