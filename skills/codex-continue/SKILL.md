---
name: codex-continue
description: "Take over an unfinished OpenAI Codex task: when Codex ran out of quota or died mid-task, read its local session logs (~/.codex), reconstruct the task, progress and interruption point, verify the workspace, then continue and finish the remaining work in this agent. Also lists recent Codex sessions."
---

# codex-continue — resume an interrupted Codex task

Codex (CLI/desktop) writes every turn to local JSONL rollout logs. A quota death has a
reliable signature: a turn gets `task_started` but never its `task_complete`. This skill
recovers "what was the task, what got done, where it stopped" so **you** (the current
agent) can finish the job. The parser script lives next to this SKILL.md.

## Steps

1. **Locate the session** — run the parser from this skill's directory:
   - Default (the common case): `node <skill-dir>/parse.mjs --interrupted`
   - By keyword (id fragment / thread name / project path): `node <skill-dir>/parse.mjs <query>`
   - Browse: `node <skill-dir>/parse.mjs list 10`
2. **Get full detail**: `node <skill-dir>/parse.mjs --json <query>` — all user prompts,
   agent messages and tool calls. If you need more, Read the underlying `.jsonl` (path is
   in the output). `CODEX_HOME` env var is respected (defaults to `~/.codex`).
3. **Cross-check the workspace** (read-only): cd to the session's `cwd` and run
   `git status --short && git diff --stat` (or, outside git, check the files touched by
   the log's `apply_patch`/write calls). If the project has its own handoff protocol
   (e.g. a `.collab/` workspace or role rules in AGENTS.md), honor it.
4. **Post a handoff summary, then continue the work.** The summary has four parts:
   original task / completed / interruption point (last agent message + the action that
   never ran) / next steps. Then actually finish the remaining work in this session —
   do not stop at reporting. Verify against the project's own acceptance criteria.
5. **Boundaries**
   - Reconcile the workspace before writing anything; don't redo or clobber what Codex
     already finished.
   - Confirm with the user before irreversible actions (delete / push / publish) or
     scope changes.
   - Old `.jsonl.zst` archives are skipped (decompress with `zstd -d` if needed).

## Log locations (reference)

- Rollouts: `$CODEX_HOME/sessions/**/rollout-*.jsonl` and `$CODEX_HOME/archived_sessions/`
- Thread-name index: `$CODEX_HOME/session_index.jsonl` (`{"id","thread_name","updated_at"}`)
