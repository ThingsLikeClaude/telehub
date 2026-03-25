# Plan: Bot Templates TeleHub Adaptation

## Executive Summary

| 항목 | 내용 |
|------|------|
| Feature | bot-templates |
| 작성일 | 2026-03-25 |
| 상태 | Plan |

### Value Delivered

| 관점 | 내용 |
|------|------|
| Problem | 기존 봇 템플릿이 macOS/cokacdir 환경에 종속되어 TeleHub에서 사용 불가 |
| Solution | 환경 참조(경로, 통신 패턴, 사용자 규칙)를 TeleHub 아키텍처에 맞게 변환 |
| Function UX Effect | 봇이 TeleHub Hub의 라우팅/핸드오프를 이해하고 올바르게 동작 |
| Core Value | 4개 봇의 개성과 협업 규칙을 유지하면서 TeleHub 환경에서 즉시 사용 가능 |

## 1. User Intent Discovery

- **핵심 문제**: macOS/cokacdir 전용 봇 설정을 Windows/TeleHub로 이식
- **대상**: TeleHub 관리자 (동현)
- **성공 기준**: 봇 템플릿이 TeleHub의 botTemplateDir로 지정 가능하고, 프로젝트 생성 시 복사되어 즉시 작동

## 2. Scope

### In Scope
- CLAUDE.md: 경로, 사용자명, Team Reference 수정
- chat-behavior.md: 존댓말 규칙, cokacdir→TeleHub 통신 패턴, 경로 제거
- natural-conversation-patterns.json: macOS 경로 제거

### Out of Scope (도메인 rules)
- research-workflow.md, dev-workflow.md, content-workflow.md 등
- 이 파일들은 원본 그대로 복사 (Claude CLI 슬래시 명령은 환경 독립적)

## 3. Modification Details

### 3.1 CLAUDE.md 변경사항
| 항목 | Before | After |
|------|--------|-------|
| Working Directory | `/Users/wavetablestudio/봇폴더` | `.` (상대경로, 봇은 자기 디렉토리에서 실행) |
| 존댓말 대상 언급 | 도현 대표님, 동현 대표님 | 제거 (chat-behavior.md에서 관리) |
| Team Reference 경로 | macOS 절대경로 | 역할 + 트리거 키워드 설명으로 대체 |
| Team Reference 봇명 | @telegram_handle | hub-config.json의 name 기준 |

### 3.2 chat-behavior.md 변경사항
| 항목 | Before | After |
|------|--------|-------|
| 존댓말 대상 | 도현/동현 대표님 2명 | 그룹챗의 모든 사용자 (봇 간은 반말) |
| 규칙 수정 권한 | 도현/동현 대표님 | 관리자 |
| Bot-to-Bot 통신 | `--message` 명령 | `#봇이름 메시지` stdout 패턴 |
| 파일 전달 | `--sendfile` | 일반 텍스트 출력 (Hub가 긴 메시지 자동 분할) |
| 공유 채팅 로그 | `/shared/chat.json`, `chat-log.sh` | 제거 (Hub가 라우팅 담당) |
| 대화 패턴 참조 경로 | `/Users/.../natural-conversation-patterns.json` | `data/natural-conversation-patterns.json` (상대경로) |
| 중재 트리거 참조 경로 | 같은 절대경로 | 같은 상대경로 |

### 3.3 natural-conversation-patterns.json 변경사항
- macOS 절대경로 참조 제거 (내용 자체는 환경 독립적이므로 그대로 유지)

## 4. Output Structure

```
bots/
├── research/          (김제헌 - 리서처)
│   ├── CLAUDE.md
│   └── rules/
│       ├── chat-behavior.md
│       ├── research-workflow.md    ← 원본 복사
│       ├── output-format.md       ← 원본 복사
│       └── collaboration.md       ← 원본 복사
├── dev/               (김용훈 - 엔지니어)
│   ├── CLAUDE.md
│   └── rules/
│       ├── chat-behavior.md
│       ├── dev-workflow.md        ← 원본 복사
│       ├── code-quality.md        ← 원본 복사
│       ├── git-convention.md      ← 원본 복사
│       └── collaboration.md       ← 원본 복사
├── marketing/         (김승훈 - 마케터)
│   ├── CLAUDE.md
│   └── rules/
│       ├── chat-behavior.md
│       ├── content-workflow.md    ← 원본 복사
│       ├── output-quality.md      ← 원본 복사
│       └── collaboration.md       ← 원본 복사
└── assistant/         (김승주 - 비서/중재)
    ├── CLAUDE.md
    ├── data/
    │   └── natural-conversation-patterns.json
    └── rules/
        └── chat-behavior.md
```

## 5. Brainstorming Log

- Q1(목적): 환경 적응만 → 캐릭터/성격 유지
- Q2(존댓말): 모든 사용자에게 존댓말 (봇 간은 반말)
- Q3(cokacdir): TeleHub 패턴으로 변환 (#봇이름 stdout)
- 접근법: A(인플레이스 수정) 선택
- YAGNI: 도메인 rules 수정은 Out of Scope
