import { describe, it, expect, vi } from 'vitest';
import { createConfigWatcher } from './watcher.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = join(tmpdir(), 'telehub-test-watcher');

describe('ConfigWatcher', () => {
  it('should create a watcher with start/stop/onReload', () => {
    mkdirSync(tmpDir, { recursive: true });
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(configPath, '{}');

    const watcher = createConfigWatcher(configPath);
    expect(typeof watcher.start).toBe('function');
    expect(typeof watcher.stop).toBe('function');
    expect(typeof watcher.onReload).toBe('function');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
