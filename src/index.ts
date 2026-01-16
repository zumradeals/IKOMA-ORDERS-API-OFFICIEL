import Fastify from 'fastify';
import * as dotenv from 'dotenv';
import dbPlugin from './plugins/db.js';
import authPlugin from './plugins/auth.js';
import adminRoutes from './routes/admin/index.js';
import runnerRoutes from './routes/runner/index.js';
import { startReconcileWorker } from './workers/reconcile.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// @ts-ignore
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const fastify = Fastify({
  logger: {
    level: 'info',
    formatters: {
      level: (label) => {
        return { level: label.toUpperCase() };
      },
    },
  },
});

// Health checks
fastify.get('/health', async () => ({ status: 'ok' }));
fastify.get('/ready', async () => ({ status: 'ready' }));

// Public installation script
fastify.get('/install-runner.sh', async (request, reply) => {
  try {
    const scriptPath = path.join(__dirname, '..', 'src', 'install-runner.sh.template');
    const content = fs.readFileSync(scriptPath, 'utf8');
    return reply
      .type('text/plain; charset=utf-8')
      .send(content);
  } catch (err) {
    fastify.log.error('Failed to serve install-runner.sh: %s', err);
    return reply.status(404).send('Installation script not found');
  }
});

// Register plugins
fastify.register(dbPlugin);
fastify.register(authPlugin);

// Register routes
fastify.register(adminRoutes, { prefix: '/v1' });
fastify.register(runnerRoutes, { prefix: '/v1' });

// Global error handler
fastify.setErrorHandler((error: unknown, request, reply) => {
  const err = error instanceof Error ? error : new Error(String(error));
  const statusCode = (error as any)?.statusCode || 500;

  if (err.message.includes('relation') && err.message.includes('does not exist')) {
    fastify.log.error('Database schema not initialized: %s', err.message);
    return reply.status(500).send({
      error: 'Internal Server Error',
      message: 'Database schema not initialized. Please run migrations.',
      code: 'DB_SCHEMA_NOT_INITIALIZED'
    });
  }
  
  fastify.log.error(err);
  reply.status(statusCode).send({
    error: err.name || 'Internal Server Error',
    message: err.message
  });
});

// Start reconcile worker after plugins are ready
fastify.ready().then(() => {
  startReconcileWorker((fastify as any).db, fastify.log);
});

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000');
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 Server listening on http://localhost:${port}`);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    fastify.log.error({ err }, "Startup error");
    process.exit(1);
  }
};

start();
