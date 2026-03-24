import type { EventBus } from '../core/event-bus.js';

export interface HealthMonitor {
  startMonitoring(botName: string): void;
  stopMonitoring(botName: string): void;
  recordActivity(botName: string): void;
  stop(): void;
}

export interface HealthMonitorOptions {
  healthTimeoutMs: number;
  checkIntervalMs: number;
  eventBus: EventBus;
}

export function createHealthMonitor(options: HealthMonitorOptions): HealthMonitor {
  const { healthTimeoutMs, checkIntervalMs, eventBus } = options;
  const lastActivity = new Map<string, number>();
  const monitored = new Set<string>();
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function check(): void {
    const now = Date.now();
    for (const botName of monitored) {
      const last = lastActivity.get(botName);
      if (last !== undefined && now - last > healthTimeoutMs) {
        eventBus.emit({ type: 'health:timeout', bot: botName });
        monitored.delete(botName); // 한 번만 알림
      }
    }
  }

  function ensureInterval(): void {
    if (intervalId === null && monitored.size > 0) {
      intervalId = setInterval(check, checkIntervalMs);
    }
  }

  function clearIntervalIfEmpty(): void {
    if (intervalId !== null && monitored.size === 0) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  return {
    startMonitoring(botName) {
      monitored.add(botName);
      ensureInterval();
    },

    stopMonitoring(botName) {
      monitored.delete(botName);
      lastActivity.delete(botName);
      clearIntervalIfEmpty();
    },

    recordActivity(botName) {
      lastActivity.set(botName, Date.now());
    },

    stop() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      monitored.clear();
      lastActivity.clear();
    },
  };
}
