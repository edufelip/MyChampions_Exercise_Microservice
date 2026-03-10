/**
 * Application entry point.
 * Creates the Express app and starts the HTTP server.
 */
import 'dotenv/config';
import { createApp } from './server';
import { config } from './config';
import { logger } from './logger';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'Exercise microservice started');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received – shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received – shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
