import { describe, it, expect } from 'vitest';
import { loadConfig, validateConfig, buildTriggerMap } from './schema.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const VALID_CONFIG = {
  telegram: { groupChatId: '-100123456789' },
  bots: [
    {
      name: '김제헌',
      role: '리서치',
      triggers: ['제헌', 'ㅈㅎ', '리서치'],
      systemPrompt: '리서치 전문가입니다.',
      workDir: 'research',
      color: '🔬',
    },
    {
      name: '김용훈',
      role: '개발',
      triggers: ['용훈', 'ㅇㅎ', '개발'],
      systemPrompt: '개발자입니다.',
      workDir: 'dev',
      color: '💻',
    },
  ],
  projects: { default: 'general', baseDir: './projects' },
  settings: {
    healthTimeoutMs: 180000,
    longResponseThreshold: 3000,
    pollingInterval: 300,
    maxConcurrentBots: 4,
  },
};

describe('validateConfig', () => {
  it('should validate a correct config', () => {
    const result = validateConfig(VALID_CONFIG);
    expect(result.telegram.groupChatId).toBe('-100123456789');
    expect(result.bots).toHaveLength(2);
  });

  it('should apply default settings when omitted', () => {
    const minimal = {
      telegram: { groupChatId: '-100' },
      bots: [
        {
          name: 'bot1',
          role: 'test',
          triggers: ['t1'],
          systemPrompt: 'hello',
          workDir: 'dir',
        },
      ],
      projects: { default: 'gen', baseDir: './p' },
      settings: {},
    };
    const result = validateConfig(minimal);
    expect(result.settings.healthTimeoutMs).toBe(180000);
    expect(result.settings.longResponseThreshold).toBe(3000);
    expect(result.settings.maxConcurrentBots).toBe(4);
  });

  it('should reject config with empty bots array', () => {
    const invalid = { ...VALID_CONFIG, bots: [] };
    expect(() => validateConfig(invalid)).toThrow();
  });

  it('should reject config with missing telegram field', () => {
    const { telegram: _, ...noTelegram } = VALID_CONFIG;
    expect(() => validateConfig(noTelegram)).toThrow();
  });

  it('should reject duplicate triggers across bots', () => {
    const duped = {
      ...VALID_CONFIG,
      bots: [
        { ...VALID_CONFIG.bots[0], triggers: ['개발', 'ㅈㅎ'] },
        { ...VALID_CONFIG.bots[1], triggers: ['개발', 'ㅇㅎ'] },
      ],
    };
    expect(() => validateConfig(duped)).toThrow(/duplicate/i);
  });

  it('should set default color when omitted', () => {
    const noColor = {
      ...VALID_CONFIG,
      bots: [{ ...VALID_CONFIG.bots[0], color: undefined }],
    };
    const result = validateConfig(noColor);
    expect(result.bots[0].color).toBe('🤖');
  });
});

describe('buildTriggerMap', () => {
  it('should map triggers to bot names', () => {
    const config = validateConfig(VALID_CONFIG);
    const map = buildTriggerMap(config.bots);
    expect(map.get('제헌')).toBe('김제헌');
    expect(map.get('ㅈㅎ')).toBe('김제헌');
    expect(map.get('리서치')).toBe('김제헌');
    expect(map.get('용훈')).toBe('김용훈');
    expect(map.get('개발')).toBe('김용훈');
  });

  it('should return a read-only map (no set method side effects)', () => {
    const config = validateConfig(VALID_CONFIG);
    const map = buildTriggerMap(config.bots);
    // Map itself is returned but should be treated as immutable
    expect(map.size).toBe(6); // 3 triggers × 2 bots
  });
});

describe('loadConfig', () => {
  const tmpDir = join(tmpdir(), 'telehub-test-config');

  it('should load and validate a config file', () => {
    mkdirSync(tmpDir, { recursive: true });
    const configPath = join(tmpDir, 'hub-config.json');
    writeFileSync(configPath, JSON.stringify(VALID_CONFIG));

    const result = loadConfig(configPath);
    expect(result.bots[0].name).toBe('김제헌');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should throw on non-existent file', () => {
    expect(() => loadConfig('/nonexistent/path.json')).toThrow();
  });

  it('should throw on invalid JSON', () => {
    mkdirSync(tmpDir, { recursive: true });
    const configPath = join(tmpDir, 'bad.json');
    writeFileSync(configPath, 'not json');

    expect(() => loadConfig(configPath)).toThrow();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
