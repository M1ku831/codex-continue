# codex-continue

> Resume an interrupted [OpenAI Codex](https://openai.com/codex/) task in another AI coding agent — no work lost, no re-explaining.

[中文文档](README.zh-CN.md)

## The problem

Codex (CLI or desktop) runs out of quota / hits a rate limit mid-task, and the turn just
dies: half-finished edits, an unpresented plan, no summary. Your other agents — Claude
Code, ZCode, OpenCode, … — still have quota, but they know nothing about what Codex was
doing, so you end up re-explaining the whole task.

You don't have to. Codex writes **every turn to local rollout logs on disk**, including
the task, every tool call, and its last message before dying.

## How it works

1. Codex stores sessions as JSONL rollouts under `$CODEX_HOME/sessions/**/rollout-*.jsonl`
   and `$CODEX_HOME/archived_sessions/`, plus a `session_index.jsonl` with thread names.
2. A quota death has a reliable log signature: a turn gets `task_started` but never its
   matching `task_complete` (clean exits have both; `turn_aborted` means you stopped it).
3. `parse.mjs` reconstructs: the original prompts, every tool call (files touched,
   commands run), the last agent message = the interruption point, and an ending status.
4. The host agent (via the skill) cross-checks the workspace (`git status`/`git diff`),
   posts a handoff summary, and **continues the remaining work itself**.

Ending statuses:

| status | meaning |
|---|---|
| `completed` | every started turn finished — nothing to take over |
| `interrupted` | a started turn never finished — the quota-death signature |
| `aborted` | you stopped Codex manually — same takeover flow applies |

## Install

```bash
git clone https://github.com/M1ku831/codex-continue.git
cd codex-continue
./install.sh            # copies skills/codex-continue into detected agent skill dirs
```

`install.sh` looks for `~/.claude/skills`, `~/.zcode/skills`, `~/.codex/skills` and
`~/.config/opencode/skills` (creates `~/.claude/skills` if none exist), or takes an
explicit destination: `./install.sh ~/.myagent/skills`. Project-level install: copy
`skills/codex-continue/` into `<project>/.claude/skills/` (or your agent's equivalent).

No agent? It still works as a plain CLI — see below.

## Usage

In any Agent-Skills-compatible agent, just ask:

- *"Take over my interrupted Codex task"* → the agent runs `parse.mjs --interrupted`,
  reconciles the workspace, shows you a handoff summary and finishes the job.
- *"Continue what Codex was doing in D:\my-project"* → keyword search by path.

CLI reference (Node ≥ 18, no dependencies):

```bash
node parse.mjs list 10            # recent sessions: time, status, project, thread name
node parse.mjs --interrupted      # summarize the most recent quota-killed session
node parse.mjs <query>            # match by session id / thread name / cwd / filename
node parse.mjs --json <query>     # full detail: prompts, agent messages, tool calls
```

Example output:

```
== session ==
thread: (unnamed)   id: 01a16c44-…
project: D:\game   started: 2026-10-24 12:56
status: interrupted (turn never finished — likely quota/limit death)   [turns: 1 started / 0 completed]

== original task (first user prompt) ==
你是本项目「策划与验收」角色…

== interruption point (last agent message) ==
我会先读取项目约定、上一轮交付代码和测试，再制定最小范围的下一轮计划…

== tool calls (last 15) ==
(no calls yet — it died right after starting)
```

## Privacy & safety

- **100% local.** The script only reads Codex's own logs on your machine; it never
  writes, uploads or phones home.
- The skill instructs the agent to reconcile the workspace before writing (so it won't
  clobber Codex's finished work) and to ask you before irreversible actions
  (delete / push / publish) or scope changes.

## Compatibility

- Codex CLI / desktop with local rollout logs (the `session_meta` / `response_item` /
  `event_msg` JSONL format); `CODEX_HOME` is respected. Tested on Windows; paths are
  cross-platform (macOS/Linux should work the same).
- Host agent: anything that can run `node` and read files — skills format works in
  Claude Code, ZCode, OpenCode, Codex itself, etc.

## Limitations

- Old compressed archives (`.jsonl.zst`) are skipped; decompress manually with `zstd -d`.
- Codex's log format may change between versions — if parsing breaks on a newer format,
  an issue/PR is very welcome.
- Very long sessions are loaded whole (fine up to tens of MB).

## License

[MIT](LICENSE)
