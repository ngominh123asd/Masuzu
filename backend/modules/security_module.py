"""
Security Module — secret scanning, dependency audit, and security linting.
When enabled, agent proactively scans for security issues.
"""
from .base_module import BaseModule, ToolDefinition


class SecurityModule(BaseModule):

    @property
    def name(self) -> str:
        return "security"

    @property
    def display_name(self) -> str:
        return "Security"

    @property
    def description(self) -> str:
        return "Secret scanning, dependency vulnerability checks, and security linting."

    @property
    def tools(self) -> list[ToolDefinition]:
        return [
            ToolDefinition(
                name="scan_secrets",
                description="Scan a directory for hardcoded secrets, API keys, and passwords",
                parameters={
                    "directory": {"type": "string", "description": "Directory path to scan"},
                },
            ),
            ToolDefinition(
                name="check_dependencies",
                description="Check dependencies for known CVEs and vulnerabilities",
                parameters={
                    "package_file": {"type": "string", "description": "Path to package file (requirements.txt, package.json, etc.)"},
                },
            ),
            ToolDefinition(
                name="lint_security",
                description="Check source code for common security issues (SQL injection, XSS, etc.)",
                parameters={
                    "file_path": {"type": "string", "description": "Path to file to lint"},
                },
            ),
        ]

    def get_claude_md_block(self) -> str:
        return """## Module: Security (ACTIVE)

### NHIỆM VỤ BẮT BUỘC KHI MODULE NÀY ĐƯỢC BẬT

**BƯỚC 1 — Quét secret/credential bị hardcode:**
```bash
# Tìm API key, password, token bị hardcode
grep -rn "api_key\|API_KEY\|password\|secret\|token\|bearer" --include="*.py" --include="*.js" --include="*.ts" --include="*.env" . | grep -v ".env.example" | grep -v "node_modules"
grep -rn "sk-\|Bearer \|ghp_\|xoxb-" . | grep -v "node_modules"
```

**BƯỚC 2 — Audit dependencies:**
```bash
# Node.js
[ -f "package.json" ] && npm audit --audit-level=high
# Python
[ -f "requirements.txt" ] && pip install safety 2>/dev/null && safety check -r requirements.txt
[ -f "pyproject.toml" ] && pip-audit 2>/dev/null || echo "pip-audit not available"
```

**BƯỚC 3 — Báo cáo và fix:**
- Liệt kê tất cả vấn đề tìm thấy theo mức độ: CRITICAL / HIGH / MEDIUM
- Fix ngay các vấn đề CRITICAL (hardcoded secrets, SQL injection)
- Đề xuất fix cho HIGH/MEDIUM

### Quy tắc Security
- KHÔNG bao giờ hardcode secret, API key, password trong code
- Luôn dùng biến môi trường (.env) cho thông tin nhạy cảm
- Kiểm tra SQL injection, XSS trong mọi input handling
- Validate và sanitize tất cả user input
"""
