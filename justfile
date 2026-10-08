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

# Verify Python types and bytecode.
check:
    {{ venv }}/ty check src
    {{ venv }}/python -m compileall -q src

# Run deterministic dataset-contract tests.
test:
    {{ venv }}/python tests/test_dataset_contract.py

# Lint Python source and tests.
lint:
    {{ venv }}/ruff check src tests

# Show working-tree status.
status:
    git status
