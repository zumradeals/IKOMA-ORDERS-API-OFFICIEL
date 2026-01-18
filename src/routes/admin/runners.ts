import { FastifyPluginAsync } from 'fastify';
import { runners, servers } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const runnerSchema = z.object({
  name: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  capabilities: z.record(z.string(), z.any()).optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const runnersRoutes: FastifyPluginAsync = async (fastify) => {
  const db = (fastify as any).db;

  fastify.get('/runners', async () => {
    const results = await db.select({
      id: runners.id,
      name: runners.name,
      status: runners.status,
      lastHeartbeatAt: runners.lastHeartbeatAt,
      scopes: runners.scopes,
      capabilities: runners.capabilities,
      createdAt: runners.createdAt,
      updatedAt: runners.updatedAt,
      serverId: servers.id,
      serverName: servers.name,
    })
    .from(runners)
    .leftJoin(servers, eq(runners.id, servers.runnerId));
    
    return results;
  });

  // POST /v1/runners (create)
  fastify.post('/runners', async (request, reply) => {
    const body = runnerSchema.parse(request.body ?? {});
    const name = body.name?.trim() || `runner-${Date.now()}`;
    const scopes = body.scopes && body.scopes.length ? body.scopes : ['default'];
    const capabilities = body.capabilities ?? { docker: true };

    // Generate a secure 32-byte hex token
    const clearToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(clearToken, 10);

    const [newRunner] = await db.insert(runners).values({
      name,
      scopes,
      capabilities,
      tokenHash,
      status: 'OFFLINE',
      updatedAt: new Date(),
    }).returning({
      id: runners.id,
      name: runners.name,
    });

    return { id: newRunner.id, name: newRunner.name, token: clearToken };
  });

  fastify.patch('/runners/:id', async (request: any, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = runnerSchema.partial().extend({
      status: z.enum(['ONLINE', 'OFFLINE', 'DISABLED']).optional(),
    }).parse(request.body);

    const [updatedRunner] = await db.update(runners)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(runners.id, id))
      .returning();

    if (!updatedRunner) {
      return reply.code(404).send({ error: 'Runner not found' });
    }
    return updatedRunner;
  });

  // POST /v1/runners/:id/token/reset (formerly rotate-token)
  fastify.post('/runners/:id/token/reset', async (request: any, reply) => {
    const { id } = idParamSchema.parse(request.params);
    
    // Check if runner exists
    const [exists] = await db.select({ id: runners.id }).from(runners).where(eq(runners.id, id)).limit(1);
    if (!exists) {
      return reply.code(404).send({ error: 'NotFound', message: 'Runner not found' });
    }

    // Generate a new secure 32-byte hex token
    const clearToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(clearToken, 10);

    await db.update(runners)
      .set({ tokenHash, updatedAt: new Date() })
      .where(eq(runners.id, id));

    return { token: clearToken };
  });

  // Keep rotate-token for backward compatibility if needed, but pointing to the same logic
  fastify.post('/runners/:id/rotate-token', async (request: any, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const clearToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(clearToken, 10);

    const [updatedRunner] = await db.update(runners)
      .set({ tokenHash, updatedAt: new Date() })
      .where(eq(runners.id, id))
      .returning();

    if (!updatedRunner) {
      return reply.code(404).send({ error: 'Runner not found' });
    }
    return { token: clearToken };
  });
};

export default runnersRoutes;
