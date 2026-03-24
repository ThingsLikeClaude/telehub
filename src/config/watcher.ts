import { watch, type FSWatcher } from 'chokidar';
import { readFileSync } from 'node:fs';
import type { HubConfig } from './schema.js';
import { validateConfig } from './schema.js';

export interface ConfigWatcher {
  start(): void;
  stop(): void;
  onReload(callback: (config: HubConfig) => void): void;
}

export function createConfigWatcher(configPath: string): ConfigWatcher {
  const callbacks: Array<(config: HubConfig) => void> = [];
  let watcher: FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function handleChange(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as unknown;
        const config = validateConfig(raw);
        for (const cb of callbacks) {
          cb(config);
        }
      } catch {
        // 유효하지 않은 config — 이전 config 유지, 무시
      }
    }, 500);
  }

  return {
    start() {
      watcher = watch(configPath, {
        awaitWriteFinish: { stabilityThreshold: 500 },
      });
      watcher.on('change', handleChange);
    },

    stop() {
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher?.close();
      watcher = null;
    },

    onReload(callback) {
      callbacks.push(callback);
    },
  };
}
