import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SessionStore {
  get(project: string, botName: string): string | null;
  set(project: string, botName: string, sessionId: string): void;
  delete(project: string, botName: string): void;
  deleteAll(project: string): void;
  getAll(project: string): Record<string, { sessionId: string; lastActive: string }>;
}

interface SessionEntry {
  sessionId: string;
  lastActive: string;
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
      writeSessions(project, {
        ...data,
        [botName]: { sessionId, lastActive: new Date().toISOString() },
      });
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
