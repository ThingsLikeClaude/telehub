import { describe, it, expect } from 'vitest';
import { createHandoffDetector } from './handoff.js';

const triggerMap = new Map([
  ['제헌', '김제헌'],
  ['용훈', '김용훈'],
  ['승훈', '김승훈'],
  ['개발', '김용훈'],
]);

describe('HandoffDetector', () => {
  const detector = createHandoffDetector(triggerMap);

  it('should detect #봇이름 pattern in output', () => {
    const result = detector.detect(
      '김제헌',
      '경쟁사 분석 완료. #용훈 이 데이터 기반으로 API를 설계해주세요.',
    );
    expect(result).toEqual({
      from: '김제헌',
      to: '김용훈',
      task: '이 데이터 기반으로 API를 설계해주세요.',
    });
  });

  it('should detect trigger word (not just name)', () => {
    const result = detector.detect('김제헌', '#개발 이걸 구현해줘');
    expect(result).toEqual(expect.objectContaining({
      to: '김용훈',
      task: '이걸 구현해줘',
    }));
  });

  it('should return null when no handoff pattern found', () => {
    const result = detector.detect('김제헌', '분석 결과를 공유합니다.');
    expect(result).toBeNull();
  });

  it('should return null for unknown trigger', () => {
    const result = detector.detect('김제헌', '#모르는봇 해줘');
    expect(result).toBeNull();
  });

  it('should not detect self-handoff', () => {
    const result = detector.detect('김제헌', '#제헌 추가 조사');
    expect(result).toBeNull();
  });

  it('should detect first handoff when multiple patterns exist', () => {
    const result = detector.detect(
      '김제헌',
      '#용훈 API 만들어줘. 그리고 #승훈 마케팅 준비해줘.',
    );
    expect(result?.to).toBe('김용훈');
  });
});
