#!/bin/sh
# Link the DSH packages this plugin imports or mounts, so the offline tests can
# run from a checkout. Idempotent; safe to re-run after upgrading DSH.
#
# Usage: sh test/link-peers.sh [dsh-executable]
# Without the argument it uses `dsh` from PATH.
set -eu

dsh_bin=${1:-$(command -v dsh)}
if [ -z "$dsh_bin" ]; then
  echo "link-peers: dsh is not on PATH; pass its path as the first argument" >&2
  exit 1
fi

resolved=$(readlink -f "$dsh_bin")
install_modules=$(dirname "$(dirname "$resolved")")/node_modules
if [ ! -d "$install_modules/@deepseek-ai/schemastery" ]; then
  echo "link-peers: $install_modules does not look like a dsh installation" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
mkdir -p node_modules/@deepseek-ai
for pkg in schemastery cordis dsh-client-connection dsh-settings; do
  target="$install_modules/@deepseek-ai/$pkg"
  link="node_modules/@deepseek-ai/$pkg"
  if [ ! -d "$target" ]; then
    echo "link-peers: $target is missing; is it a dsh release without dev peers?" >&2
    exit 1
  fi
  rm -f "$link"
  ln -s "$target" "$link"
done

echo "link-peers: linked schemastery, cordis, dsh-client-connection and dsh-settings from $install_modules"
