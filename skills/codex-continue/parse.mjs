#!/usr/bin/env node
// codex-continue — recover interrupted OpenAI Codex sessions from local rollout logs.
//
// Usage:
//   node parse.mjs list [N]          list the N most recent sessions (default 10)
//   node parse.mjs <query>           summarize the best-matching session
//                                    (query matches session id / thread name / cwd / filename)
//   node parse.mjs --interrupted     summarize the most recent quota-interrupted session
//   node parse.mjs --json <query>    machine-readable full detail (prompts, messages, tool calls)
//
// Env: CODEX_HOME overrides the Codex home dir (defaults to ~/.codex).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const ROOTS = [path.join(CODEX_HOME, 'sessions'), path.join(CODEX_HOME, 'archived_sessions')];

function findRollouts() {
  const out = [];
  const walk = d => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  ROOTS.forEach(walk);
  return out.map(f => ({ f, m: fs.statSync(f).mtimeMs })).sort((a, b) => b.m - a.m);
}

function findCompressed() {
  const out = [];
  const walk = d => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl.zst')) out.push(p);
    }
  };
  ROOTS.forEach(walk);
  return out;
}

function threadNames() {
  const map = {};
  try {
    for (const l of fs.readFileSync(path.join(CODEX_HOME, 'session_index.jsonl'), 'utf8').trim().split('\n')) {
      try { const j = JSON.parse(l); if (j.id) map[j.id] = j.thread_name || ''; } catch {}
    }
  } catch {}
  return map;
}

// Codex injects its own context blocks as user-role messages; the real task is the rest.
const SYS_INJECT = /^(# AGENTS\.md|<environment_context|<user_instructions|<external_codex|<turn_context|<COMPAT|# CompatId)/i;

function parseSession(file) {
  const items = [];
  for (const l of fs.readFileSync(file, 'utf8').trim().split('\n')) {
    try { items.push(JSON.parse(l)); } catch {}
  }
  const meta = (items.find(j => j.type === 'session_meta') || {}).payload || {};
  const userMsgs = [], agentMsgs = [], calls = [], errors = [];
  let starts = 0, completes = 0, aborted = false, model = '';
  for (const j of items) {
    const pl = j.payload || {};
    if (j.type === 'event_msg') {
      if (pl.type === 'task_started') starts++;
      else if (pl.type === 'task_complete') completes++;
      else if (pl.type === 'turn_aborted') aborted = true;
      else if (/error/i.test(pl.type || '')) errors.push(pl.message || pl.type);
    } else if (j.type === 'turn_context' && pl.model && !model) {
      model = pl.model;
    } else if (j.type === 'response_item') {
      if (pl.type === 'message' && pl.role === 'user') {
        const txt = (pl.content || []).map(c => c.text || '').join('\n').trim();
        if (txt && !SYS_INJECT.test(txt)) userMsgs.push(txt);
      } else if (pl.type === 'agent_message' || (pl.type === 'message' && pl.role === 'assistant')) {
        const txt = (pl.content || []).map(c => c.text || '').join('\n').trim();
        if (txt) agentMsgs.push(txt);
      } else if (pl.type === 'function_call' || pl.type === 'custom_tool_call') {
        calls.push({ name: pl.name, args: String(pl.arguments ?? pl.input ?? '').slice(0, 300) });
      }
    }
  }
  const errText = errors.join(' | ');
  const quotaHint = /usage.?limit|rate.?limit|quota|out of credit/i.test(errText);
  const status = aborted ? 'aborted (user stopped)'
    : completes > 0 && completes >= starts ? 'completed'
    : starts > completes ? (quotaHint ? 'interrupted (limit/quota error in log)' : 'interrupted (turn never finished — likely quota/limit death)')
    : 'unknown';
  return {
    file, id: meta.id || '', cwd: meta.cwd || '?', model,
    timestamp: meta.timestamp || items[0]?.timestamp || '',
    starts, completes, aborted, status, errors,
    userMsgs, agentMsgs, calls,
  };
}

const trunc = (s, n) => (s.length > n ? s.slice(0, n) + ` …[truncated, ${s.length} chars total]` : s);
const fmtTime = t => {
  const d = new Date(t);
  if (isNaN(d)) return String(t);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const label = s => `${fmtTime(s.timestamp)}  ${s.status.padEnd(28)}  ${s.cwd}${s.model ? '  [' + s.model + ']' : ''}`;

const args = process.argv.slice(2);
const jsonFlag = args.includes('--json');
const wantInterrupted = args.includes('--interrupted');
const query = args.filter(a => a !== '--json' && a !== '--interrupted').join(' ').trim();

const rollouts = findRollouts();
const names = threadNames();

if (!rollouts.length) {
  const zst = findCompressed();
  console.error(`No rollout logs found under ${CODEX_HOME}/sessions or ${CODEX_HOME}/archived_sessions.` +
    (zst.length ? `\n${zst.length} compressed archives (.jsonl.zst) exist — decompress with: zstd -d <file>` : ''));
  process.exit(1);
}

// ---- list mode ----
if (!wantInterrupted && (!query || /^list\b/i.test(query))) {
  const n = Math.min(parseInt((query.match(/(\d+)/) || [])[1] || '10', 10), 50);
  console.log(`#   time                status                        cwd / [model] / thread`);
  rollouts.slice(0, n).forEach((r, i) => {
    const s = parseSession(r.f);
    console.log(`${String(i + 1).padStart(2)}  ${label(s)}  / ${names[s.id] || '(unnamed)'}`);
  });
  console.log(`\nThen: node parse.mjs <id-fragment | thread-name | cwd keyword>   (or --interrupted)`);
  process.exit(0);
}

// ---- match ----
let hits = rollouts.map(r => parseSession(r.f)).filter(s => {
  if (wantInterrupted && !s.status.startsWith('interrupted')) return false;
  if (!query) return true;
  const q = query.toLowerCase();
  return s.id.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q)
    || (names[s.id] || '').toLowerCase().includes(q)
    || path.basename(s.file).toLowerCase().includes(q);
});
if (!hits.length) {
  console.error(wantInterrupted
    ? `No interrupted session found in the last ${rollouts.length} rollout(s). Run: node parse.mjs list 10`
    : `No session matching "${query}". Run: node parse.mjs list 10`);
  process.exit(1);
}
const s = hits[0];
const others = hits.slice(1, 11);

// ---- output ----
if (jsonFlag) {
  const cap = arr => arr.map(t => trunc(t, 4000));
  console.log(JSON.stringify({
    ...s,
    thread_name: names[s.id] || '',
    userMsgs: cap(s.userMsgs),
    agentMsgs: cap(s.agentMsgs),
    other_matches: others.map(o => ({ id: o.id, cwd: o.cwd, time: fmtTime(o.timestamp), thread_name: names[o.id] || '', file: o.file })),
  }, null, 1));
} else {
  console.log([
    others.length ? `(matched ${hits.length} sessions — summarizing the most recent; refine the query to pick another)` : ``,
    `== session ==`,
    `thread: ${names[s.id] || '(unnamed)'}   id: ${s.id}${s.model ? '   model: ' + s.model : ''}`,
    `project: ${s.cwd}   started: ${fmtTime(s.timestamp)}`,
    `status: ${s.status}   [turns: ${s.starts} started / ${s.completes} completed]`,
    s.errors.length ? `errors: ${trunc(s.errors.join(' | '), 300)}` : ``,
    ``,
    `== original task (first user prompt) ==`,
    trunc(s.userMsgs[0] || '(not captured)', 1500),
    s.userMsgs.length > 1 ? `\n[+${s.userMsgs.length - 1} more user messages — use --json for full text]` : ``,
    ``,
    `== interruption point (last agent message) ==`,
    trunc(s.agentMsgs[s.agentMsgs.length - 1] || '(no output)', 1500),
    ``,
    `== tool calls (last 15) ==`,
    ...s.calls.slice(-15).map(c => `- ${c.name}: ${trunc(c.args.replace(/\s+/g, ' '), 160)}`),
  ].filter(Boolean).join('\n'));
}
