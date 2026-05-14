"""
Testing Module — automated test running, coverage, and test generation.
When enabled, the agent will proactively:
1. Detect the project type and available test frameworks
2. Run existing tests and report failures
3. Generate missing test cases when writing new code
"""
from .base_module import BaseModule, ToolDefinition


class TestingModule(BaseModule):

    @property
    def name(self) -> str:
        return "testing"

    @property
    def display_name(self) -> str:
        return "Testing"

    @property
    def description(self) -> str:
        return "Automated test running, coverage reports, and test skeleton generation."

    @property
    def tools(self) -> list[ToolDefinition]:
        return [
            ToolDefinition(
                name="run_tests",
                description="Run the test suite for the project",
                parameters={
                    "test_command": {"type": "string", "description": "Test command to execute (e.g. pytest, npm test)"},
                    "working_dir": {"type": "string", "description": "Working directory to run tests in"},
                },
            ),
            ToolDefinition(
                name="get_coverage_report",
                description="Get the test coverage report",
                parameters={},
            ),
            ToolDefinition(
                name="generate_test_skeleton",
                description="Generate a test file skeleton for a source file",
                parameters={
                    "source_file": {"type": "string", "description": "Path to the source file to generate tests for"},
                },
            ),
        ]

    def get_claude_md_block(self) -> str:
        return """## Module: Testing (ACTIVE)

### NHIỆM VỤ BẮT BUỘC KHI MODULE NÀY ĐƯỢC BẬT

**BƯỚC 1 — Auto-detect project type (chạy ngay, không cần hỏi):**
```bash
# Phát hiện project type
ls -la
[ -f "package.json" ] && echo "NODE" && cat package.json | grep -A5 '"scripts"'
[ -f "requirements.txt" ] && echo "PYTHON" && cat requirements.txt
[ -f "pyproject.toml" ] && echo "PYTHON-UV" && cat pyproject.toml | grep -A5 "\\[tool.pytest"
[ -f "Cargo.toml" ] && echo "RUST"
[ -f "go.mod" ] && echo "GO"
```

**BƯỚC 2 — Chạy test theo project type:**
- **Node.js**: `npm test` hoặc `npx jest` hoặc `npx vitest run`
- **Python**: `pytest -v` hoặc `python -m pytest -v --tb=short`
- **Python (uv)**: `uv run pytest -v`
- **Rust**: `cargo test`
- **Go**: `go test ./...`

**BƯỚC 3 — Báo cáo kết quả:**
- Liệt kê test nào PASS / FAIL
- Với mỗi test FAIL: đọc stack trace, xác định nguyên nhân, sửa code, chạy lại
- Nếu CHƯA có test nào: tạo test file phù hợp với project (KHÔNG tạo a.txt, b.txt)

### Quy tắc Testing
- Khi viết code mới: LUÔN tạo test tương ứng TRONG CÙNG session
- Test phải cover: happy path, edge cases, error handling
- KHÔNG bao giờ tạo file a.txt, b.txt, c.txt hay các file dummy
- Chạy test → xem kết quả → sửa lỗi → chạy lại đến khi PASS hết
"""
