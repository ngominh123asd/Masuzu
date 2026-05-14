FROM python:3.11-slim

WORKDIR /app

# Install Node.js (for running claude CLI from mounted volume)
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI from npm
RUN npm install -g @anthropic-ai/claude-code

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create non-root user (claude CLI refuses --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash agent \
    && chown -R agent:agent /app \
    && mkdir -p /app/workspaces && chown -R agent:agent /app/workspaces

USER agent

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
