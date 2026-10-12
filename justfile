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
    {{ venv }}/pytest tests

# Lint and format-check Python source and tests.
lint:
    {{ venv }}/ruff check src tests
    {{ venv }}/ruff format --check src tests

# Install repository pre-commit and commit-message hooks.
install-hooks:
    {{ venv }}/pre-commit install
    {{ venv }}/pre-commit install --hook-type commit-msg

# Run all repository pre-commit hooks without committing.
hooks:
    {{ venv }}/pre-commit run --all-files

# Create a Conventional Commit (hooks validate message format).
commit *args:
    git commit {{ args }}

# Show working-tree status.
status:
    git status
