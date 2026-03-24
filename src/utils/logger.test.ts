import { describe, it, expect, vi } from 'vitest';
import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('should create a logger with info level', () => {
    const logger = createLogger({ level: 'info', name: 'test' });
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('should output JSON lines to stdout', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createLogger({ level: 'info', name: 'hub' });

    logger.info('hello world', { key: 'value' });

    expect(spy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.msg).toBe('hello world');
    expect(output.name).toBe('hub');
    expect(output.level).toBe('info');
    expect(output.key).toBe('value');
    expect(output.ts).toBeDefined();

    spy.mockRestore();
  });

  it('should not output debug when level is info', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createLogger({ level: 'info', name: 'hub' });

    logger.debug('debug msg');

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should output debug when level is debug', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createLogger({ level: 'debug', name: 'hub' });

    logger.debug('debug msg');

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('should output error to stderr', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger({ level: 'info', name: 'hub' });

    logger.error('bad thing', { code: 500 });

    expect(spy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.level).toBe('error');
    expect(output.code).toBe(500);

    spy.mockRestore();
  });

  it('should create child logger with merged context', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createLogger({ level: 'info', name: 'hub' });
    const child = logger.child({ bot: '김제헌' });

    child.info('working');

    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.bot).toBe('김제헌');
    expect(output.msg).toBe('working');

    spy.mockRestore();
  });
});
