export interface BotStatusInfo {
  name: string;
  role: string;
  color: string;
  status: 'idle' | 'busy' | 'error' | 'starting';
  currentTask?: string;
}

export interface QueueInfo {
  bot: string;
  size: number;
}

const STATUS_EMOJI: Record<string, string> = {
  idle: '💤',
  busy: '⏳',
  error: '❌',
  starting: '🔄',
};

export function formatStatusDashboard(
  project: string,
  bots: BotStatusInfo[],
  queueInfo: QueueInfo[],
): string {
  const lines: string[] = [];
  lines.push(`📂 현재 프로젝트: ${project}`);

  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i];
    const prefix = i === bots.length - 1 ? '└' : '├';
    const emoji = STATUS_EMOJI[bot.status] ?? '❓';
    const task = bot.status === 'busy' && bot.currentTask
      ? `: ${bot.currentTask} ${emoji}`
      : `: 대기 ${emoji}`;
    lines.push(`${prefix} ${bot.color} ${bot.name}(${bot.role})${task}`);
  }

  const nonEmptyQueues = queueInfo.filter((q) => q.size > 0);
  if (nonEmptyQueues.length > 0) {
    const queueLines = nonEmptyQueues.map(
      (q) => `${q.bot}: ${q.size}건`,
    );
    lines.push('');
    lines.push(`대기열: ${queueLines.join(', ')}`);
  }

  return lines.join('\n');
}
