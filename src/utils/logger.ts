export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function createLogger(options: {
  level: LogLevel;
  name: string;
  context?: Record<string, unknown>;
}): Logger {
  const threshold = LEVEL_ORDER[options.level];
  const baseContext = { name: options.name, ...options.context };

  function log(
    level: LogLevel,
    msg: string,
    meta?: Record<string, unknown>,
  ): void {
    if (LEVEL_ORDER[level] < threshold) return;

    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      ...baseContext,
      msg,
      ...meta,
    });

    if (level === 'error' || level === 'warn') {
      console.error(entry);
    } else {
      console.log(entry);
    }
  }

  return {
    debug: (msg, meta) => log('debug', msg, meta),
    info: (msg, meta) => log('info', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    error: (msg, meta) => log('error', msg, meta),
    child: (context) =>
      createLogger({
        level: options.level,
        name: options.name,
        context: { ...baseContext, ...context },
      }),
  };
}
