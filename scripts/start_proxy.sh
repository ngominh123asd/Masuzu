#!/bin/bash
# Start the free-claude-code proxy server
cd "$(dirname "$0")/../proxy"

echo "Starting free-claude-code proxy on port 8082..."
echo "Admin UI: http://localhost:8082/admin"

uv run uvicorn server:app --host 0.0.0.0 --port 8082
