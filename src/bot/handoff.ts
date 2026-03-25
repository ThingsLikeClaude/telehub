export interface HandoffRequest {
  from: string;
  to: string;
  task: string;
}

export interface HandoffDetector {
  detect(botName: string, output: string): HandoffRequest | null;
}

const HANDOFF_PATTERN = /;(\S+)\s+(.+)/;

export function createHandoffDetector(triggerMap: Map<string, string>): HandoffDetector {
  return {
    detect(botName: string, output: string): HandoffRequest | null {
      const match = output.match(HANDOFF_PATTERN);
      if (!match) return null;

      const [, trigger, task] = match;
      const targetBot = triggerMap.get(trigger);
      if (!targetBot) return null;

      // self-handoff 방지
      if (targetBot === botName) return null;

      return { from: botName, to: targetBot, task: task.trim() };
    },
  };
}
