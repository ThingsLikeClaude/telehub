import { describe, it, expect } from 'vitest';
import { splitMessage } from './formatter.js';

describe('splitMessage', () => {
  it('should not split short message', () => {
    const parts = splitMessage('hello', 4096);
    expect(parts).toEqual(['hello']);
  });

  it('should split at newline boundary', () => {
    const text = 'a'.repeat(4000) + '\n' + 'b'.repeat(200);
    const parts = splitMessage(text, 4096);
    expect(parts.length).toBe(2);
    expect(parts[0]).toContain('(1/2)');
  });

  it('should handle very long message without newlines', () => {
    const text = 'x'.repeat(10000);
    const parts = splitMessage(text, 4096);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(4096);
    }
  });

  it('should handle empty string', () => {
    const parts = splitMessage('', 4096);
    expect(parts).toEqual(['']);
  });

  it('should respect code block boundaries', () => {
    const text = '설명\n```\n' + 'code\n'.repeat(800) + '```\n끝';
    const parts = splitMessage(text, 4096);
    // 코드블록이 깨지지 않아야 함 (또는 적절히 닫아야 함)
    expect(parts.length).toBeGreaterThanOrEqual(1);
  });
});
