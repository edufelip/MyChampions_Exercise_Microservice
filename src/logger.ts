/**
 * Structured logger using pino with automatic redaction of sensitive fields.
 */
import pino from 'pino';
import { config } from './config';

const redactPaths = [
  'authorization',
  'Authorization',
  'req.headers.authorization',
  'req.headers.Authorization',
  'body.request.headers',
  'apiKey',
  'api_key',
];

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]',
  },
  ...(config.nodeEnv !== 'production'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }
    : {}),
});
