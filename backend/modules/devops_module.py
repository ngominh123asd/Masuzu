"""
DevOps Module — Dockerfile generation, GitHub Actions, and Docker builds.
When enabled, agent ensures the project is containerized and has CI/CD.
"""
from .base_module import BaseModule, ToolDefinition


class DevOpsModule(BaseModule):

    @property
    def name(self) -> str:
        return "devops"

    @property
    def display_name(self) -> str:
        return "DevOps"

    @property
    def description(self) -> str:
        return "Dockerfile generation, CI/CD pipeline creation, and Docker image building."

    @property
    def tools(self) -> list[ToolDefinition]:
        return [
            ToolDefinition(
                name="generate_dockerfile",
                description="Generate an optimized Dockerfile for the project",
                parameters={
                    "project_type": {"type": "string", "description": "Project type (python, node, go, rust, etc.)"},
                },
            ),
            ToolDefinition(
                name="generate_github_actions",
                description="Generate a GitHub Actions CI/CD workflow",
                parameters={
                    "workflow_type": {"type": "string", "description": "Workflow type (ci, deploy, release)"},
                },
            ),
            ToolDefinition(
                name="run_docker_build",
                description="Build a Docker image and verify it works",
                parameters={
                    "context_path": {"type": "string", "description": "Docker build context path"},
                },
            ),
        ]

    def get_claude_md_block(self) -> str:
        return """## Module: DevOps (ACTIVE)

### NHIỆM VỤ BẮT BUỘC KHI MODULE NÀY ĐƯỢC BẬT

**BƯỚC 1 — Kiểm tra hiện trạng containerization:**
```bash
ls -la Dockerfile docker-compose.yml .dockerignore .github/workflows/ 2>/dev/null
[ -f "Dockerfile" ] && echo "Dockerfile tồn tại" || echo "THIẾU Dockerfile"
[ -f ".dockerignore" ] && echo ".dockerignore tồn tại" || echo "THIẾU .dockerignore"
```

**BƯỚC 2 — Tạo/hoàn thiện nếu thiếu:**
- Nếu thiếu **Dockerfile**: tạo với multi-stage build phù hợp project type
- Nếu thiếu **.dockerignore**: tạo để loại trừ node_modules, __pycache__, .git, .env
- Nếu thiếu **CI/CD**: tạo `.github/workflows/ci.yml` với build + test pipeline

**BƯỚC 3 — Verify Docker build (nếu Docker có sẵn):**
```bash
docker build -t test-build . && echo "BUILD SUCCESS" || echo "BUILD FAILED"
```

### Quy tắc DevOps
- Mọi project phải có Dockerfile và .dockerignore
- Dùng multi-stage builds để tối ưu image size
- ENV variables phải được document trong .env.example
- CI pipeline phải bao gồm: lint → test → build
"""
