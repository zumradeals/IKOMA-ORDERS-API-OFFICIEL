import { FastifyPluginAsync } from 'fastify';
import { playbooks } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const playbookSchema = z.object({
  key: z.string(),
  name: z.string(),
  category: z.enum(['BASE', 'STANDARD', 'ADVANCED', 'CUSTOM']),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  requiresScopes: z.array(z.string()).optional(),
  schemaVersion: z.string(),
  spec: z.record(z.string(), z.any()),
});

const playbooksRoutes: FastifyPluginAsync = async (fastify) => {
  const db = (fastify as any).db;

  fastify.get('/playbooks', async () => {
    return await db.select().from(playbooks);
  });

  fastify.post('/playbooks', async (request, reply) => {
    const body = playbookSchema.parse(request.body);
    const [newPlaybook] = await db.insert(playbooks).values(body).returning();
    return newPlaybook;
  });

  fastify.patch('/playbooks/:key', async (request: any, reply) => {
    const { key } = request.params;
    const body = playbookSchema.partial().parse(request.body);

    const [updatedPlaybook] = await db.update(playbooks)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(playbooks.key, key))
      .returning();

    if (!updatedPlaybook) {
      return reply.code(404).send({ error: 'Playbook not found' });
    }
    return updatedPlaybook;
  });

  fastify.post('/playbooks/:key/publish', async (request: any, reply) => {
    const { key } = request.params;
    const [updatedPlaybook] = await db.update(playbooks)
      .set({ isPublished: 'true', updatedAt: new Date() })
      .where(eq(playbooks.key, key))
      .returning();

    if (!updatedPlaybook) {
      return reply.code(404).send({ error: 'Playbook not found' });
    }
    return updatedPlaybook;
  });
};

export default playbooksRoutes;
