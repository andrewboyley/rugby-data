set shell := ["bash", "-cu"]

venv := ".venv/bin"

default:
    @just --list

# Install dependencies into the project virtualenv
setup:
    uv sync

# Build the rugby dataset from the ESPN API (resumable, cached)
dataset *args:
    {{ venv }}/rugby-composition-predictor dataset {{ args }}

# Rebuild the dataset (forwards extra args, e.g. --reset).
alias build := dataset

# Build the Svelte viewer into dist/.
[working-directory("web")]
web:
    npm ci && npm run build

[private]
dev command *args:
    cd web && ./scripts/dev-server.sh {{ command }} {{ args }}

# Dev server management via script (start/stop/restart/status/logs/follow)
dev-start: (dev "start")

dev-stop: (dev "stop")

dev-restart: (dev "restart")

dev-status: (dev "status")

dev-logs lines="100": (dev "logs" lines)

dev-follow: (dev "follow")

# Serve the built viewer with Vite (localhost:8787); rebuilds first.
[working-directory("web")]
serve: web
    npm run preview

# Verify the Python package compiles.
check-python:
    {{ venv }}/ty check src
    {{ venv }}/python -m compileall -q src

# Lint the Python package.
lint-python:
    {{ venv }}/ruff check --fix src

# Type-check the Svelte viewer.
[working-directory("web")]
check-web:
    npm run typecheck

# Lint the Svelte viewer.
[working-directory("web")]
lint-web:
    npm run lint:fix

# Run the browser and temporal integration suite.
[working-directory("web")]
test-web *args:
    npx playwright test {{ args }}

# Run the OpenSpec-driven Ralph builder. Usage: just ralph [iterations]
ralph iterations="100":
    ralph --prompt-file .ralph/prompt.md --agent opencode --allow-all --no-commit --no-questions --max-iterations {{ iterations }} --completion-promise COMPLETE --abort-promise BLOCKED

# Show working-tree status
status:
    git status

# Stage all changes
stage:
    git add -A

# Create a commit with a conventional-commits message.
# Usage: just commit <type> <summary> [body]
#   type: feat | fix | refactor | chore | docs | test | perf | style | build | revert
# Example: just commit fix "resume skips cached events" "only mark complete games processed"
commit type summary body="":
    @test "{{ type }}" = "feat" -o "{{ type }}" = "fix" -o "{{ type }}" = "refactor" -o "{{ type }}" = "chore" -o "{{ type }}" = "docs" -o "{{ type }}" = "test" -o "{{ type }}" = "perf" -o "{{ type }}" = "style" -o "{{ type }}" = "build" -o "{{ type }}" = "revert" || { echo "invalid type: {{ type }}"; exit 1; }
    git add -A
    @if [ -n "{{ body }}" ]; then git commit -m "{{ type }}: {{ summary }}" -m "{{ body }}"; else git commit -m "{{ type }}: {{ summary }}"; fi
