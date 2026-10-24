# codex-continue

> 在另一个 AI 编程智能体里无缝接手被打断的 [OpenAI Codex](https://openai.com/codex/) 任务——不丢进度、不用重新解释。

[English](README.md)

## 问题

Codex（CLI 或桌面版）经常在任务干到一半时额度用尽 / 触发限流，回合直接死掉：改了一半的代码、没给出的方案、没有任何总结。你的其他智能体——Claude Code、ZCode、OpenCode 等——还有额度，但它们完全不知道 Codex 在干什么，你只能把任务重新解释一遍。

其实不必。Codex 会把**每一轮会话完整写在本地日志里**：任务原文、每次工具调用、死掉前的最后一句话，都在磁盘上。

## 工作原理

1. Codex 把会话存成 JSONL rollout：`$CODEX_HOME/sessions/**/rollout-*.jsonl` 和
   `$CODEX_HOME/archived_sessions/`，另有 `session_index.jsonl` 存线程名。
2. 额度断掉有可靠的日志特征：某回合有 `task_started` 却没有配对的 `task_complete`
   （正常结束两者相等；`turn_aborted` 是你手动停止）。
3. `parse.mjs` 还原出：任务原文、每次工具调用（改了哪些文件、跑了哪些命令）、
   最后一条 agent 消息（即中断点）、以及结束状态。
4. 宿主智能体（通过技能）核对工作区（`git status` / `git diff`），给出交接摘要，
   然后**自己把剩余工作做完**。

结束状态：

| 状态 | 含义 |
|---|---|
| `completed` | 每个开始的回合都正常完成——无需接手 |
| `interrupted` | 有回合没做完——额度断掉的典型特征 |
| `aborted` | 你手动停止了 Codex——同样可以接手 |

## 安装

```bash
git clone https://github.com/M1ku831/codex-continue.git
cd codex-continue
./install.sh            # 把 skills/codex-continue 复制到已检测到的智能体技能目录
```

`install.sh` 会查找 `~/.claude/skills`、`~/.zcode/skills`、`~/.codex/skills`、
`~/.config/opencode/skills`（都不存在则创建 `~/.claude/skills`），也可以指定目录：
`./install.sh ~/.myagent/skills`。项目级安装：把 `skills/codex-continue/` 复制到
`<项目>/.claude/skills/`（或你的智能体的对应目录）。

没有智能体也能用——它本身就是个命令行工具，见下文。

## 用法

在任何支持 Agent Skills 的智能体里直接说：

- *"接手我中断的 Codex 任务"* → 智能体运行 `parse.mjs --interrupted`，
  核对工作区，给出交接摘要，然后干完剩下的活。
- *"继续 Codex 在 D:\my-project 里做的任务"* → 按路径关键词检索。

命令行参考（Node ≥ 18，零依赖）：

```bash
node parse.mjs list 10            # 最近的会话：时间、状态、项目、线程名
node parse.mjs --interrupted      # 摘要最近一个额度断掉的会话
node parse.mjs <关键词>            # 按会话 id / 线程名 / 项目路径 / 文件名匹配
node parse.mjs --json <关键词>     # 完整细节：用户指令、agent 消息、工具调用
```

输出示例：

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

## 隐私与安全

- **完全本地。** 脚本只读取你机器上 Codex 自己的日志，不写入、不上传、不联网。
- 技能会要求智能体先核对工作区再动手（不会覆盖 Codex 已完成的修改），并且
  在不可逆操作（删除 / 推送 / 发布）或超出原任务范围前先征求你的确认。

## 兼容性

- 有本地 rollout 日志的 Codex CLI / 桌面版（`session_meta` / `response_item` /
  `event_msg` 的 JSONL 格式）；支持 `CODEX_HOME` 环境变量。在 Windows 上测试通过，
  路径处理跨平台（macOS / Linux 应当一致）。
- 宿主智能体：任何能跑 `node`、能读文件的都行——技能格式适用于 Claude Code、
  ZCode、OpenCode、Codex 本身等。

## 已知限制

- 旧压缩档（`.jsonl.zst`）默认跳过；需要时手动 `zstd -d` 解压。
- Codex 日志格式可能随版本变化——如果新版解析失败，欢迎提 issue / PR。
- 很长的会话会整体读入内存（几十 MB 以内没问题）。

## 许可证

[MIT](LICENSE)
