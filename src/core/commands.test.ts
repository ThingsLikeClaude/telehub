import { describe, it, expect } from 'vitest';
import { formatStatusDashboard } from './commands.js';

describe('formatStatusDashboard', () => {
  it('should format bot statuses into dashboard', () => {
    const bots = [
      { name: '김제헌', role: '리서치', color: '🔬', status: 'busy' as const, currentTask: '경쟁사 분석 중...' },
      { name: '김용훈', role: '개발', color: '💻', status: 'idle' as const, currentTask: undefined },
      { name: '김승훈', role: '마케팅', color: '📣', status: 'idle' as const, currentTask: undefined },
    ];
    const result = formatStatusDashboard('my-project', bots, []);
    expect(result).toContain('my-project');
    expect(result).toContain('김제헌');
    expect(result).toContain('경쟁사 분석 중...');
    expect(result).toContain('⏳');
    expect(result).toContain('💤');
  });

  it('should show queue info', () => {
    const bots = [
      { name: '김제헌', role: '리서치', color: '🔬', status: 'busy' as const, currentTask: '작업중' },
    ];
    const queueInfo = [{ bot: '김제헌', size: 2 }];
    const result = formatStatusDashboard('proj', bots, queueInfo);
    expect(result).toContain('대기열');
    expect(result).toContain('2');
  });

  it('should handle all idle bots', () => {
    const bots = [
      { name: '김제헌', role: '리서치', color: '🔬', status: 'idle' as const, currentTask: undefined },
    ];
    const result = formatStatusDashboard('proj', bots, []);
    expect(result).toContain('💤');
  });
});
