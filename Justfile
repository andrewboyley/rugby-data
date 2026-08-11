set shell := ["bash", "-cu"]

project := "rugby-composition-predictor"
venv := ".venv/bin"

# --- setup -------------------------------------------------------------------

# Install dependencies into the project virtualenv
setup:
    uv sync

# Build the rugby dataset from the ESPN API (resumable, cached)
dataset:
    {{ venv }}/rugby-composition-predictor dataset

# Derive the player co-occurrence graph from the dataset
graph:
    {{ venv }}/rugby-composition-predictor graph

# Rebuild both dataset and graph
build: dataset graph

# --- web ---------------------------------------------------------------------

# Build the Svelte viewer into dist/
web:
    cd web && npm ci && npm run build

# Vite dev server with hot reload (serves repo data/ on /data)
dev:
    cd web && npm run dev

# Serve the built viewer with Vite (localhost:8787); rebuilds first
serve: web
    cd web && npm run preview

# --- checks ------------------------------------------------------------------

# Verify the package compiles
check:
    {{ venv }}/python -m compileall -q src

# Lint the codebase (requires ruff)
lint:
    {{ venv }}/ruff check src

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
