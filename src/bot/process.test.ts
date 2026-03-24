import { describe, it, expect } from 'vitest';
import { parseStreamLine, type StreamEvent } from './process.js';

describe('parseStreamLine', () => {
  it('should parse assistant text event', () => {
    const line = JSON.stringify({
      type: 'assistant',
      subtype: 'text',
      content_block_delta: { text: 'hello' },
    });
    const event = parseStreamLine(line);
    expect(event).toEqual({
      type: 'assistant',
      subtype: 'text',
      content: 'hello',
    });
  });

  it('should parse result event with sessionId', () => {
    const line = JSON.stringify({
      type: 'result',
      session_id: 'sess-123',
      cost_usd: 0.05,
    });
    const event = parseStreamLine(line);
    expect(event).toEqual(expect.objectContaining({
      type: 'result',
      sessionId: 'sess-123',
      costUsd: 0.05,
    }));
  });

  it('should return null for invalid JSON', () => {
    expect(parseStreamLine('not json')).toBeNull();
  });

  it('should return null for empty line', () => {
    expect(parseStreamLine('')).toBeNull();
  });

  it('should handle system event', () => {
    const line = JSON.stringify({ type: 'system', subtype: 'init' });
    const event = parseStreamLine(line);
    expect(event?.type).toBe('system');
  });
});
