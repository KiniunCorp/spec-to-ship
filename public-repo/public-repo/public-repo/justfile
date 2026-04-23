set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
  @just --list

help:
  @just --list

# Run the current checkout directly without touching the global s2s binary
dev *args:
  npm run cli {{args}}

# Show which source/build/global s2s version is currently active
install-status:
  node scripts/dev-install-status.mjs

# Manual local install of s2s CLI from source
install:
  npm install
  npm run build
  npm link
  @just install-status

# Refresh the global link to point at the current checkout/build
reinstall:
  npm install
  npm run build
  npm unlink -g spec-to-ship || true
  npm link
  @just install-status

# Remove the global npm link for this checkout
uninstall:
  npm unlink -g spec-to-ship || true
  @just install-status

build:
  npm run build

typecheck:
  npm run typecheck

check:
  npm run check

selfhost-apply:
  npm run selfhost:apply

selfhost-clean:
  npm run selfhost:clean
