import { describe, it, expect } from 'vitest';
import { createQueueManager } from './queue.js';

const makeRoute = (text: string) => ({
  target: '김제헌',
  text,
  chatId: -100,
  messageId: 1,
  userId: 111,
  source: 'keyword' as const,
});

describe('QueueManager', () => {
  it('should enqueue and dequeue items', () => {
    const queue = createQueueManager();
    const pos = queue.enqueue('김제헌', makeRoute('task1'));
    expect(pos).toBe(1);
    const item = queue.dequeue('김제헌');
    expect(item?.text).toBe('task1');
  });

  it('should return null when dequeue from empty queue', () => {
    const queue = createQueueManager();
    expect(queue.dequeue('김제헌')).toBeNull();
  });

  it('should maintain FIFO order', () => {
    const queue = createQueueManager();
    queue.enqueue('김제헌', makeRoute('first'));
    queue.enqueue('김제헌', makeRoute('second'));
    queue.enqueue('김제헌', makeRoute('third'));
    expect(queue.dequeue('김제헌')?.text).toBe('first');
    expect(queue.dequeue('김제헌')?.text).toBe('second');
    expect(queue.dequeue('김제헌')?.text).toBe('third');
  });

  it('should track size per bot', () => {
    const queue = createQueueManager();
    queue.enqueue('김제헌', makeRoute('a'));
    queue.enqueue('김제헌', makeRoute('b'));
    queue.enqueue('김용훈', makeRoute('c'));
    expect(queue.size('김제헌')).toBe(2);
    expect(queue.size('김용훈')).toBe(1);
    expect(queue.size('김승훈')).toBe(0);
  });

  it('should peek without removing', () => {
    const queue = createQueueManager();
    queue.enqueue('김제헌', makeRoute('peek me'));
    expect(queue.peek('김제헌')?.text).toBe('peek me');
    expect(queue.size('김제헌')).toBe(1);
  });

  it('should clear queue for a bot', () => {
    const queue = createQueueManager();
    queue.enqueue('김제헌', makeRoute('a'));
    queue.enqueue('김제헌', makeRoute('b'));
    queue.clear('김제헌');
    expect(queue.size('김제헌')).toBe(0);
  });

  it('should clearAll queues', () => {
    const queue = createQueueManager();
    queue.enqueue('김제헌', makeRoute('a'));
    queue.enqueue('김용훈', makeRoute('b'));
    queue.clearAll();
    expect(queue.size('김제헌')).toBe(0);
    expect(queue.size('김용훈')).toBe(0);
  });

  it('should reject when queue exceeds max size (10)', () => {
    const queue = createQueueManager();
    for (let i = 0; i < 10; i++) {
      queue.enqueue('김제헌', makeRoute(`task-${i}`));
    }
    expect(queue.size('김제헌')).toBe(10);
    const pos = queue.enqueue('김제헌', makeRoute('overflow'));
    expect(pos).toBe(-1); // rejected
    expect(queue.size('김제헌')).toBe(10);
  });
});
