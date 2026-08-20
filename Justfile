set shell := ["bash", "-cu"]

project := "rugby-composition-predictor"
venv := ".venv/bin"

# --- setup -------------------------------------------------------------------

# Install dependencies into the project virtualenv
setup:
    uv sync

# Build the rugby dataset from the ESPN API (resumable, cached)
dataset *args:
    {{ venv }}/rugby-composition-predictor dataset {{args}}

# Derive the player co-occurrence graph from the dataset
graph:
    {{ venv }}/rugby-composition-predictor graph

# Rebuild both dataset and graph (forwards extra args to `dataset`, e.g. --reset)
build *args:
    {{ venv }}/rugby-composition-predictor dataset {{args}}
    {{ venv }}/rugby-composition-predictor graph

# --- web ---------------------------------------------------------------------

# Build the Svelte viewer into dist/
web:
    cd web && npm ci && npm run build

# Dev server management via script (start/stop/restart/status/logs/follow)
dev-start:
    cd web && ./scripts/dev-server.sh start

dev-stop:
    cd web && ./scripts/dev-server.sh stop

dev-restart:
    cd web && ./scripts/dev-server.sh restart

dev-status:
    cd web && ./scripts/dev-server.sh status

dev-logs *lines="100":
    cd web && ./scripts/dev-server.sh logs {{lines}}

dev-follow:
    cd web && ./scripts/dev-server.sh follow

# Serve the built viewer with Vite (localhost:8787); rebuilds first
serve: web
    cd web && npm run preview

# --- checks ------------------------------------------------------------------

# Verify the package compiles
check-python:
    {{ venv }}/ty check src
    {{ venv }}/python -m compileall -q src

# Lint the codebase (requires ruff)
lint-python:
    {{ venv }}/ruff check --fix src

check-web:
    cd web && npm run typecheck

lint-web:
    cd web && npm run lint:fix
    

# --- git ---------------------------------------------------------------------

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
