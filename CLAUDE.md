# TeleHub — Telegram Agent Teams Hub

## Project Overview

TeleHub은 여러 Telegram 봇이 하나의 그룹챗에서 Claude Code Agent Teams처럼 협업하는 Node.js 기반 오케스트레이션 시스템이다.

- **Language**: Node.js (TypeScript)
- **AI Engine**: Claude CLI subprocess (구독 기반, SDK 아님)
- **Platform**: macOS only, pm2 background
- **Inspired by**: [cokacdir](https://github.com/kstost/cokacdir) by kstost

## Quick Start for New Session

### PRD 생성 (첫 세션)
```
/pm-discovery
```
PRD seed 문서(`docs/prd-seed.md`)와 인터뷰 기록(`docs/interviews/interview-telehub-2026-03-24.md`)을 읽고 PRD를 생성한다.

### 개발 시작 (PRD 이후)
```
/pdca plan telehub
```

## Key Documents

- `docs/prd-seed.md` — PRD 시드 (인터뷰 기반 요구사항)
- `docs/interviews/interview-telehub-2026-03-24.md` — 상세 인터뷰 기록 (25문항)

## Architecture

```
TeleHub Hub (Node.js single process)
├── Telegram Polling → Message Parser
├── Router (#keyword / reply / broadcast)
├── Bot Manager (Claude CLI spawn/resume/kill)
├── EventEmitter (in-memory bot comms, ~0ms)
├── Queue Manager (per-bot request queue)
├── Session Store (project-based JSON)
├── Health Monitor (stdout heartbeat, 3min threshold)
└── Config Watcher (fs.watch hot-reload)
```

## Core Concepts

- **`#봇이름`**: prefix trigger로 특정 봇 호출
- **Reply routing**: 봇 메시지에 답장하면 해당 봇에게 자동 라우팅
- **`#얘들아`**: Hub가 Claude CLI로 메시지 분류 후 적절한 봇에게 배분
- **Handoff**: 봇이 stdout에 `#다른봇 요청` 패턴 출력 → Hub 감지 → 라우팅
- **Session**: 프로젝트 단위로 Claude CLI session ID 관리 (--resume)

## Coding Conventions

- TypeScript strict mode
- ESM modules
- Functional style, avoid mutation (spread for new objects)
- File ≤ 800 lines / Function ≤ 50 lines / Nesting ≤ 4 levels
- Meaningful variable names in English
- Comments in Korean allowed

## Bot Roster (Initial)

| Name | Role | Triggers |
|------|------|----------|
| 김제헌 | 리서치 | 제헌, ㅈㅎ, 리서치 |
| 김용훈 | 개발 | 용훈, ㅇㅎ, 개발 |
| 김승훈 | 마케팅 | 승훈, 마케팅 |
| 김승주 | 비서 | 승주, 비서 |
