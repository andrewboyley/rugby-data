set shell := ["bash", "-cu"]

venv := ".venv/bin"

default:
    @just --list

# Install Python dependencies into the project virtualenv.
setup:
    uv sync

# Build the international rugby dataset (resumable and cached).
dataset *args:
    {{ venv }}/rugby-data dataset {{ args }}

# Rebuild from cached API responses.
alias build := dataset

# Serve the local versioned dataset over HTTP.
serve *args:
    {{ venv }}/rugby-data serve {{ args }}

# Verify Python types and bytecode.
check:
    {{ venv }}/ty check src
    {{ venv }}/python -m compileall -q src

# Run deterministic tests (excludes local-cache diagnostic test_fetch_entities.py).
test:
    {{ venv }}/python -m unittest discover -s tests -p 'test_*.py'

# Lint Python source and tests.
lint:
    {{ venv }}/ruff check src tests

# Show working-tree status.
status:
    git status
