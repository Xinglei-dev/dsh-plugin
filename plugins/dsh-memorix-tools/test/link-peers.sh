#!/bin/sh
# Link the DSH packages this plugin resolves at run time and in tests, so the
# suite can run from a checkout. Idempotent; safe to re-run after upgrading DSH.
#
# Usage: sh test/link-peers.sh [dsh-executable]
# Without the argument it uses `dsh` from PATH.
set -eu

dsh_bin=${1:-$(command -v dsh || true)}
if [ -z "$dsh_bin" ]; then
  echo "link-peers: dsh is not on PATH; pass its path as the first argument" >&2
  exit 1
fi

resolved=$(readlink -f "$dsh_bin")
install_modules=$(dirname "$(dirname "$resolved")")/node_modules
if [ ! -d "$install_modules/@deepseek-ai/dsh-tools" ]; then
  echo "link-peers: $install_modules does not look like a dsh installation" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
mkdir -p node_modules/@deepseek-ai
# `schemastery` is a runtime peer (Config). `cordis` and `dsh-tools` are only
# used by the real-registry test; without them that file skips.
for pkg in schemastery cordis dsh-tools; do
  target="$install_modules/@deepseek-ai/$pkg"
  link="node_modules/@deepseek-ai/$pkg"
  if [ ! -d "$target" ]; then
    echo "link-peers: $target is missing; is it a dsh release without dev peers?" >&2
    exit 1
  fi
  rm -f "$link"
  ln -s "$target" "$link"
done

echo "link-peers: linked schemastery, cordis, and dsh-tools from $install_modules"
