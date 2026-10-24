#!/usr/bin/env bash
# codex-continue installer — copies skills/codex-continue into your agent's skills dir.
# Usage: ./install.sh [destination-dir]   (default: every detected agent skills dir)
set -euo pipefail

SRC="$(cd "$(dirname "$0")/skills/codex-continue" && pwd)"
[ -f "$SRC/SKILL.md" ] || { echo "error: $SRC/SKILL.md not found"; exit 1; }

if [ $# -ge 1 ]; then
  DESTS=("$1")
else
  DESTS=("$HOME/.claude/skills" "$HOME/.zcode/skills" "$HOME/.codex/skills" "$HOME/.config/opencode/skills")
  # keep at least one target if none of the agent dirs exist yet
  if ! ls -d "${DESTS[@]}" >/dev/null 2>&1; then
    DESTS=("$HOME/.claude/skills")
  fi
fi

for d in "${DESTS[@]}"; do
  mkdir -p "$d/codex-continue"
  cp "$SRC/SKILL.md" "$SRC/parse.mjs" "$d/codex-continue/"
  echo "installed: $d/codex-continue"
done
echo "done. In your agent, say: \"take over my interrupted Codex task\" (or run: node <skill-dir>/parse.mjs --interrupted)"
