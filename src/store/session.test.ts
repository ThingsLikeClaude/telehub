import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSessionStore } from './session.js';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const baseDir = join(tmpdir(), 'telehub-test-sessions');

describe('SessionStore', () => {
  beforeEach(() => {
    mkdirSync(baseDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('should set and get a session', () => {
    const store = createSessionStore(baseDir);
    store.set('proj1', '김제헌', 'session-abc');
    expect(store.get('proj1', '김제헌')).toBe('session-abc');
  });

  it('should return null for non-existent session', () => {
    const store = createSessionStore(baseDir);
    expect(store.get('proj1', '김제헌')).toBeNull();
  });

  it('should persist across instances', () => {
    const store1 = createSessionStore(baseDir);
    store1.set('proj1', '김제헌', 'session-xyz');

    const store2 = createSessionStore(baseDir);
    expect(store2.get('proj1', '김제헌')).toBe('session-xyz');
  });

  it('should delete a session', () => {
    const store = createSessionStore(baseDir);
    store.set('proj1', '김제헌', 'session-abc');
    store.delete('proj1', '김제헌');
    expect(store.get('proj1', '김제헌')).toBeNull();
  });

  it('should deleteAll for a project', () => {
    const store = createSessionStore(baseDir);
    store.set('proj1', '김제헌', 's1');
    store.set('proj1', '김용훈', 's2');
    store.deleteAll('proj1');
    expect(store.get('proj1', '김제헌')).toBeNull();
    expect(store.get('proj1', '김용훈')).toBeNull();
  });

  it('should keep sessions isolated by project', () => {
    const store = createSessionStore(baseDir);
    store.set('proj1', '김제헌', 's1');
    store.set('proj2', '김제헌', 's2');
    expect(store.get('proj1', '김제헌')).toBe('s1');
    expect(store.get('proj2', '김제헌')).toBe('s2');
  });

  it('should return all sessions for a project', () => {
    const store = createSessionStore(baseDir);
    store.set('proj1', '김제헌', 's1');
    store.set('proj1', '김용훈', 's2');
    const all = store.getAll('proj1');
    expect(all['김제헌'].sessionId).toBe('s1');
    expect(all['김용훈'].sessionId).toBe('s2');
    expect(all['김제헌'].lastActive).toBeDefined();
  });

  it('should create project directory if not exists', () => {
    const store = createSessionStore(baseDir);
    store.set('new-proj', '김제헌', 's1');
    expect(existsSync(join(baseDir, 'new-proj'))).toBe(true);
  });
});
