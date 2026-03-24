# Interview: TeleHub - Telegram Agent Teams Hub

Date: 2026-03-24T07:45:28Z
Questions asked: 25
Mode: full

## Overview

TeleHub is a Node.js-based Telegram multi-bot orchestration system that brings Claude Code's Agent Teams experience to Telegram. Multiple AI bots collaborate in a single group chat, each specializing in different roles, sharing a common project context.

## Decisions Made

1. **Language**: Node.js (not Rust fork) — faster development, Claude CLI remains subprocess
2. **AI Execution**: Claude CLI subprocess (not SDK) — uses subscription, retains all built-in tools (Bash, Read, Write, Edit, etc.)
3. **Trigger System**: `#` prefix for bot invocation (`#제헌`, `#얘들아`)
4. **Routing Priority**: Keyword matching first → Claude judgment only for `#얘들아` (broadcast)
5. **Reply Routing**: Telegram native reply (swipe) routes to the bot whose message is being replied to — no `#` needed
6. **Hub Distribution**: Hub uses Claude CLI subprocess for `#얘들아` message classification
7. **Concurrency**: Queue-based — if bot is busy, requests are queued (not denied like cokacdir)
8. **Handoff**: Bots auto-handoff via `#botname` pattern in stdout + custom tool `handoff(to, task)`, Hub validates routing
9. **Session Persistence**: Project-based — Claude CLI `--resume sessionId`, sessions stored per project
10. **Context Clear**: `#클리어` per bot, `#전체클리어` for all bots — discards session IDs, starts fresh
11. **Long Response**: Short → Telegram message, long → file attachment (auto-switch)
12. **Health Check**: Heartbeat via stdout events — 3min no-event → notify user, user decides restart/stop
13. **Security**: No restrictions — `--dangerously-skip-permissions`, all users equal trust
14. **Bot Config**: `hub-config.json` — bots can modify it via Claude CLI, Hub hot-reloads on file change
15. **Runtime**: macOS local + pm2 background (no EC2)
16. **Project Name**: telehub

## Scope

### In Scope
- Multi-bot orchestration (4+ bots in single group chat)
- `#` prefix triggering with partial name matching
- Telegram reply-based routing
- Hub-mediated distribution for broadcast messages
- Bot-to-bot handoff with Hub validation
- Project switching and status dashboard
- Queue-based request management
- Session persistence per project (Claude CLI --resume)
- Context clear per bot and global
- Long response → auto file attachment
- Heartbeat monitoring (3min no-event threshold)
- Hot-reloadable config
- pm2 background execution on macOS

### Out of Scope
- EC2/cloud deployment
- Docker containerization
- User permission differentiation
- Webhook (may consider later, polling for MVP simplicity)
- Token encryption (trust-based environment)

## Bot Configuration

| Name | Role | Triggers | Subdir |
|------|------|----------|--------|
| 김제헌 | 리서치 | 제헌, ㅈㅎ, 리서치 | research/ |
| 김용훈 | 개발 | 용훈, ㅇㅎ, 개발 | dev/ |
| 김승훈 | 마케팅 | 승훈, 마케팅 | marketing/ |
| 김승주 | 비서 | 승주, 비서 | assistant/ |

Additional bots can be added via `hub-config.json`.

## Technical Decisions

### Architecture
```
┌─────────────────────────────────────────┐
│  TeleHub (Node.js, single process)      │
│                                          │
│  EventEmitter / MessageBus (in-memory)  │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐│
│  │제헌  │←→│용훈  │←→│승훈  │←→│승주  ││
│  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘│
│     │         │         │         │     │
│  claude CLI  claude CLI claude CLI claude│
│  (subprocess)(subprocess)(subprocess)   │
└─────────────────────────────────────────┘
```

- **Bot-to-bot comms**: Node.js EventEmitter — in-memory, ~0ms latency (vs cokacdir 5s file polling)
- **Message routing**: `#name` keyword match → direct route; `#얘들아` → Hub spawns Claude CLI for classification
- **Reply routing**: Telegram `reply_to_message` field → identify which bot's message → route to that bot
- **Streaming**: Claude CLI `--output-format stream-json` → stdout parsing → Telegram message updates
- **Session management**: `projects/{name}/sessions.json` maps bot names to Claude session IDs
- **Config hot-reload**: `fs.watch` on `hub-config.json` → apply changes without restart

### Message Flow
```
Telegram Message
  → TeleHub receives via teloxide/polling
  → Parse: has `#`? → keyword match → route to bot
  → Parse: is reply? → check reply_to_message → route to original bot
  → No match? → ignore (user-to-user conversation)

Bot receives message:
  → Check queue (busy?) → queue if busy, process if idle
  → Spawn/resume Claude CLI subprocess
  → Stream stdout → parse events → update Telegram
  → On completion: check for handoff patterns in output
  → If handoff: Hub validates → route to next bot
```

### Trigger System
```
#제헌 조사해줘          → keyword "제헌" → 김제헌 bot
#제헌아 이거 해줘       → keyword "제헌" → 김제헌 bot
#얘들아 이거 분석하자   → broadcast → Hub Claude judgment → distribute
#상태                   → system command → show dashboard
#프로젝트               → system command → list projects
#전환 project-name      → system command → switch project
#클리어                 → system command → clear current bot session
#전체클리어             → system command → clear all bot sessions
#끝                     → system command → release active session
[reply to bot message]  → route to that bot (no # needed)
```

### Status Dashboard
```
📂 현재 프로젝트: marketing-seunghun
├ 제헌(리서치): 경쟁사 분석 중... ⏳
├ 용훈(개발): 대기 💤
├ 승훈(마케팅): 카피 작성 완료 ✅
└ 승주(비서): 대기 💤

대기열: 1건 (제헌 → "시장 규모 조사")
```

## Data & Integration

### File Structure
```
~/projects/
├── hub-config.json          # Bot definitions, triggers, roles
├── projects/
│   ├── marketing-seunghun/
│   │   ├── config.json      # Project-specific settings
│   │   ├── sessions.json    # Bot → session ID mapping
│   │   ├── research/        # 제헌 working dir
│   │   ├── dev/             # 용훈 working dir
│   │   ├── marketing/       # 승훈 working dir
│   │   └── assistant/       # 승주 working dir
│   └── another-project/
│       └── ...
└── logs/                    # Hub logs
```

### Dependencies
- `node-telegram-bot-api` or `telegraf` — Telegram Bot API
- `child_process` — Claude CLI subprocess management
- `pm2` — Process management for background execution
- `chokidar` or `fs.watch` — Config file hot-reload

## Constraints

- macOS only (no cross-platform requirement)
- Claude Pro/Max subscription required (no API costs)
- Single Telegram group chat per project (multi-group not required initially)
- Telegram Bot API limits: 4096 chars per message, 50MB file upload
- Each bot token must be unique (one BotFather token per bot)

## Validation Criteria

- [ ] 4 bots respond independently to `#name` triggers in a single group chat
- [ ] Reply-based routing works without `#` prefix
- [ ] `#얘들아` distributes tasks via Hub Claude judgment
- [ ] Bot-to-bot handoff works (stdout pattern + custom tool)
- [ ] Queue holds requests when bot is busy
- [ ] Project switching preserves/restores sessions
- [ ] `#상태` shows accurate dashboard
- [ ] `#클리어` resets bot session
- [ ] Long responses auto-convert to file attachment
- [ ] 3min no-event triggers user notification
- [ ] Config changes hot-reload without restart
- [ ] pm2 keeps Hub running in background

## Assumptions Confirmed

- Users are trusted team members (no permission restrictions)
- Claude CLI `--resume` works reliably for session persistence
- Claude CLI `--output-format stream-json` provides real-time stdout events
- Telegram reply_to_message field is accessible via Bot API
- pm2 is acceptable for macOS background process management
- No need for webhook — polling is acceptable for initial version

## Open Questions

- Exact Telegram bot library choice for Node.js (telegraf vs node-telegram-bot-api)
- Polling interval optimization (balance between responsiveness and API rate limits)
- Log rotation strategy for Hub logs
- Whether to support DM (1:1) in addition to group chat
- 5th bot role (PM/기획, 디자인, QA — deferred)

## Origin

This project is inspired by [cokacdir](https://github.com/kstost/cokacdir) by kstost.
TeleHub extracts and reimagines the Telegram chatbot functionality with:
- Node.js instead of Rust
- In-memory EventEmitter instead of file-based polling
- Agent Teams-style collaboration instead of independent bots
- Hub-mediated routing instead of simple prefix matching
