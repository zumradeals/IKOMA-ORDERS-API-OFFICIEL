import { FastifyPluginAsync } from 'fastify';
import { servers } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const serverSchema = z.object({
  name: z.string(),
  baseUrl: z.string().url(),
  metadata: z.record(z.string(), z.any()).optional(),
  tags: z.array(z.string()).optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const serversRoutes: FastifyPluginAsync = async (fastify) => {
  const db = (fastify as any).db;

  fastify.get('/servers', async () => {
    return await db.select().from(servers);
  });

  fastify.post('/servers', async (request, reply) => {
    const body = serverSchema.parse(request.body);
    const [newServer] = await db.insert(servers).values(body).returning();
    return newServer;
  });

  const attachRunnerHandler = async (request: any, reply: any) => {
    const { id } = idParamSchema.parse(request.params);
    const { runnerId } = z.object({ runnerId: z.string().uuid() }).parse(request.body);
    
    const [updatedServer] = await db.update(servers)
      .set({ runnerId, updatedAt: new Date() })
      .where(eq(servers.id, id))
      .returning();
    
    if (!updatedServer) {
      return reply.code(404).send({ error: 'Server not found' });
    }
    return updatedServer;
  };

  fastify.patch('/servers/:id/attach-runner', attachRunnerHandler);
  fastify.post('/servers/:id/attach-runner', attachRunnerHandler);
};

export default serversRoutes;
