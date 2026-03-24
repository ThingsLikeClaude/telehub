import { EventEmitter } from 'node:events';

export type HubEvent =
  | { type: 'bot:message'; from: string; to: string; text: string }
  | { type: 'bot:complete'; bot: string; output: string; sessionId: string }
  | { type: 'bot:error'; bot: string; error: string }
  | { type: 'bot:handoff'; from: string; to: string; task: string }
  | { type: 'queue:enqueued'; bot: string; position: number }
  | { type: 'queue:dequeued'; bot: string }
  | { type: 'health:timeout'; bot: string }
  | { type: 'config:reloaded' }
  | { type: 'project:switched'; from: string; to: string };

export interface EventBus {
  emit(event: HubEvent): void;
  on<T extends HubEvent['type']>(
    type: T,
    handler: (event: Extract<HubEvent, { type: T }>) => void,
  ): void;
  off(type: HubEvent['type'], handler: Function): void;
}

export function createEventBus(): EventBus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  return {
    emit(event: HubEvent): void {
      emitter.emit(event.type, event);
    },

    on(type, handler) {
      emitter.on(type, handler as (...args: unknown[]) => void);
    },

    off(type, handler) {
      emitter.off(type, handler as (...args: unknown[]) => void);
    },
  };
}
