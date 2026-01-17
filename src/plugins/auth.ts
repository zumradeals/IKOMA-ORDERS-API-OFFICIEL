import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { runners } from '../db/schema.js';

declare module 'fastify' {
  interface FastifyRequest {
    isAdmin: boolean;
    runner?: {
      id: string;
      scopes: string[];
    };
  }
}

const authPlugin: FastifyPluginCallback = (fastify, opts, done) => {
  fastify.decorateRequest('isAdmin', false);
  fastify.decorateRequest('runner', undefined);

  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminKey = request.headers['x-ikoma-admin-key'];
    const runnerId = request.headers['x-runner-id'] as string;
    const runnerToken = request.headers['x-runner-token'] as string;

    // Admin Auth
    if (adminKey && adminKey === process.env.IKOMA_ADMIN_KEY) {
      request.isAdmin = true;
      return;
    }

    // Runner Auth
    if (runnerId && runnerToken) {
      const db = (fastify as any).db;
      const [runner] = await db.select().from(runners).where(eq(runners.id, runnerId)).limit(1);

      if (runner && runner.status !== 'DISABLED') {
        const isValid = await bcrypt.compare(runnerToken, runner.tokenHash);
        if (isValid) {
          request.runner = {
            id: runner.id,
            scopes: runner.scopes,
          };
          return;
        }
      }
    }
  });

  fastify.decorate('verifyAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.isAdmin) {
      return reply.code(401).send({ 
        error: 'Unauthorized', 
        message: 'Admin access required',
        code: 'ADMIN_AUTH_REQUIRED'
      });
    }
  });

  fastify.decorate('verifyRunner', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.runner) {
      return reply.code(401).send({ 
        error: 'Unauthorized', 
        message: 'Runner access required',
        code: 'RUNNER_AUTH_REQUIRED'
      });
    }
  });

  done();
};

export default fp(authPlugin);
