import pino from 'pino';
import { z } from 'zod';

const LoggingEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const config = LoggingEnvironmentSchema.parse(process.env);
const transport =
  config.NODE_ENV === 'development'
    ? pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
      })
    : undefined;

export const logger = pino(
  {
    level: config.LOG_LEVEL,
    base: { service: 'askesis-api', environment: config.NODE_ENV },
    redact: {
      paths: [
        'authorization',
        'headers.authorization',
        'req.headers.authorization',
        'CLERK_SECRET_KEY',
        'DATABASE_URL',
        '*.token',
        '*.secret',
      ],
      censor: '[REDACTED]',
    },
  },
  transport,
);
