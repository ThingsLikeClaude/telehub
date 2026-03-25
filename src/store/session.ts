import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface SessionStore {
  get(project: string, botName: string): string | null;
  set(project: string, botName: string, sessionId: string): void;
  setUsage(project: string, botName: string, usage: SessionUsage): void;
  getUsage(project: string, botName: string): SessionUsage | null;
  delete(project: string, botName: string): void;
  deleteAll(project: string): void;
  getAll(project: string): Record<string, SessionEntry>;
}

interface SessionEntry {
  sessionId: string;
  lastActive: string;
  usage?: SessionUsage;
}

type SessionData = Record<string, SessionEntry>;

export function createSessionStore(baseDir: string): SessionStore {
  function sessionPath(project: string): string {
    return join(baseDir, project, 'sessions.json');
  }

  function ensureDir(project: string): void {
    const dir = join(baseDir, project);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  function readSessions(project: string): SessionData {
    const path = sessionPath(project);
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as SessionData;
    } catch {
      return {};
    }
  }

  function writeSessions(project: string, data: SessionData): void {
    ensureDir(project);
    writeFileSync(sessionPath(project), JSON.stringify(data, null, 2));
  }

  return {
    get(project, botName) {
      const data = readSessions(project);
      return data[botName]?.sessionId ?? null;
    },

    set(project, botName, sessionId) {
      const data = readSessions(project);
      const existing = data[botName];
      writeSessions(project, {
        ...data,
        [botName]: { ...existing, sessionId, lastActive: new Date().toISOString() },
      });
    },

    setUsage(project, botName, usage) {
      const data = readSessions(project);
      const existing = data[botName];
      if (existing) {
        writeSessions(project, {
          ...data,
          [botName]: { ...existing, usage },
        });
      }
    },

    getUsage(project, botName) {
      const data = readSessions(project);
      return data[botName]?.usage ?? null;
    },

    delete(project, botName) {
      const data = readSessions(project);
      const { [botName]: _, ...rest } = data;
      writeSessions(project, rest);
    },

    deleteAll(project) {
      writeSessions(project, {});
    },

    getAll(project) {
      return readSessions(project);
    },
  };
}
