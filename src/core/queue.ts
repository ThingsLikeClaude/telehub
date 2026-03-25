export interface RouteResult {
  target: string;
  text: string;
  chatId: number;
  messageId: number;
  userId: number;
  source: 'keyword' | 'reply' | 'broadcast' | 'handoff';
  depth?: number;  // 핸드오프 체인 깊이 (0=유저 직접, 1=첫 핸드오프, ...)
}

export interface QueueManager {
  enqueue(botName: string, route: RouteResult): number;
  dequeue(botName: string): RouteResult | null;
  peek(botName: string): RouteResult | null;
  size(botName: string): number;
  clear(botName: string): void;
  clearAll(): void;
}

const MAX_QUEUE_SIZE = 10;

export function createQueueManager(): QueueManager {
  const queues = new Map<string, RouteResult[]>();

  function getQueue(botName: string): RouteResult[] {
    let q = queues.get(botName);
    if (!q) {
      q = [];
      queues.set(botName, q);
    }
    return q;
  }

  return {
    enqueue(botName, route) {
      const q = getQueue(botName);
      if (q.length >= MAX_QUEUE_SIZE) return -1;
      q.push(route);
      return q.length;
    },

    dequeue(botName) {
      const q = getQueue(botName);
      return q.shift() ?? null;
    },

    peek(botName) {
      const q = getQueue(botName);
      return q[0] ?? null;
    },

    size(botName) {
      return queues.get(botName)?.length ?? 0;
    },

    clear(botName) {
      queues.delete(botName);
    },

    clearAll() {
      queues.clear();
    },
  };
}
