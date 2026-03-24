import { watch, type FSWatcher } from 'chokidar';
import { readFileSync } from 'node:fs';
import type { HubConfig } from './schema.js';
import { validateConfig } from './schema.js';
import type { Logger } from '../utils/logger.js';

export interface ConfigWatcher {
  start(): void;
  stop(): void;
  onReload(callback: (config: HubConfig) => void): void;
}

export function createConfigWatcher(configPath: string, logger?: Logger): ConfigWatcher {
  const callbacks: Array<(config: HubConfig) => void> = [];
  let watcher: FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function handleChange(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as unknown;
        const config = validateConfig(raw);
        logger?.info('Config reloaded successfully', { bots: config.bots.length });
        for (const cb of callbacks) {
          cb(config);
        }
      } catch (err) {
        logger?.warn('Config reload failed — keeping previous config', {
          error: err instanceof Error ? err.message : String(err),
        });
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
