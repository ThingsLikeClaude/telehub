import { describe, it, expect, vi } from 'vitest';
import { createEventBus, type HubEvent } from './event-bus.js';

describe('EventBus', () => {
  it('should emit and receive events', () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on('bot:complete', handler);
    bus.emit({ type: 'bot:complete', bot: '김제헌', output: 'done', sessionId: 's1' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bot:complete', bot: '김제헌' }),
    );
  });

  it('should not trigger handler for different event type', () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on('bot:error', handler);
    bus.emit({ type: 'bot:complete', bot: '김제헌', output: '', sessionId: '' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should support multiple handlers', () => {
    const bus = createEventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('bot:complete', h1);
    bus.on('bot:complete', h2);
    bus.emit({ type: 'bot:complete', bot: '김제헌', output: '', sessionId: '' });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('should remove handler with off', () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on('bot:complete', handler);
    bus.off('bot:complete', handler);
    bus.emit({ type: 'bot:complete', bot: '김제헌', output: '', sessionId: '' });
    expect(handler).not.toHaveBeenCalled();
  });
});
