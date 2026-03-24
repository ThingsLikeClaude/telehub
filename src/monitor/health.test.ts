import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHealthMonitor } from './health.js';
import { createEventBus } from '../core/event-bus.js';

describe('HealthMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not trigger timeout when activity is recorded', () => {
    const eventBus = createEventBus();
    const handler = vi.fn();
    eventBus.on('health:timeout', handler);

    const monitor = createHealthMonitor({
      healthTimeoutMs: 3000,
      checkIntervalMs: 1000,
      eventBus,
    });

    monitor.startMonitoring('김제헌');
    monitor.recordActivity('김제헌');

    // 2초 진행 (타임아웃 3초 이내)
    vi.advanceTimersByTime(2000);
    expect(handler).not.toHaveBeenCalled();

    monitor.stop();
  });

  it('should trigger timeout after healthTimeoutMs with no activity', () => {
    const eventBus = createEventBus();
    const handler = vi.fn();
    eventBus.on('health:timeout', handler);

    const monitor = createHealthMonitor({
      healthTimeoutMs: 3000,
      checkIntervalMs: 1000,
      eventBus,
    });

    monitor.startMonitoring('김제헌');
    monitor.recordActivity('김제헌');

    // 4초 진행 (타임아웃 3초 초과)
    vi.advanceTimersByTime(4000);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'health:timeout', bot: '김제헌' }),
    );

    monitor.stop();
  });

  it('should reset timeout when activity is recorded', () => {
    const eventBus = createEventBus();
    const handler = vi.fn();
    eventBus.on('health:timeout', handler);

    const monitor = createHealthMonitor({
      healthTimeoutMs: 3000,
      checkIntervalMs: 1000,
      eventBus,
    });

    monitor.startMonitoring('김제헌');
    monitor.recordActivity('김제헌');

    vi.advanceTimersByTime(2000);
    monitor.recordActivity('김제헌'); // 리셋

    vi.advanceTimersByTime(2000); // 리셋 후 2초 — 아직 안 넘음
    expect(handler).not.toHaveBeenCalled();

    monitor.stop();
  });

  it('should stop monitoring a bot', () => {
    const eventBus = createEventBus();
    const handler = vi.fn();
    eventBus.on('health:timeout', handler);

    const monitor = createHealthMonitor({
      healthTimeoutMs: 3000,
      checkIntervalMs: 1000,
      eventBus,
    });

    monitor.startMonitoring('김제헌');
    monitor.recordActivity('김제헌');
    monitor.stopMonitoring('김제헌');

    vi.advanceTimersByTime(5000);
    expect(handler).not.toHaveBeenCalled();

    monitor.stop();
  });
});
