import { FastifyPluginAsync } from 'fastify';
import { orders, orderLogs } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';

const orderCreateSchema = z.object({
  serverId: z.string().uuid(),
  playbookKey: z.string(),
  action: z.string(),
  payload: z.record(z.string(), z.any()).optional(),
  idempotencyKey: z.string(),
  dedupeKey: z.string().optional(),
  timeoutSec: z.number().optional(),
  maxAttempts: z.number().optional(),
  createdBy: z.string(),
});

const ordersRoutes: FastifyPluginAsync = async (fastify) => {
  const db = (fastify as any).db;

  fastify.get('/orders', async () => {
    return await db.select().from(orders);
  });

  fastify.get('/orders/:id', async (request: any, reply) => {
    const { id } = request.params;
    const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    return order;
  });

  fastify.post('/orders', async (request, reply) => {
    const body = orderCreateSchema.parse(request.body);
    
    // Check idempotency
    const [existing] = await db.select().from(orders).where(eq(orders.idempotencyKey, body.idempotencyKey)).limit(1);
    if (existing) return existing;

    const [newOrder] = await db.insert(orders).values({
      ...body,
      status: 'QUEUED',
    }).returning();
    
    return newOrder;
  });

  fastify.post('/orders/:id/cancel', async (request: any, reply) => {
    const { id } = request.params;
    const [updatedOrder] = await db.update(orders)
      .set({ status: 'CANCELED', updatedAt: new Date() })
      .where(and(eq(orders.id, id), eq(orders.status, 'QUEUED')))
      .returning();

    if (!updatedOrder) {
      return reply.code(400).send({ error: 'Order cannot be canceled (not in QUEUED state)' });
    }
    return updatedOrder;
  });

  fastify.get('/orders/:id/logs', async (request: any, reply) => {
    const { id } = request.params;
    return await db.select().from(orderLogs).where(eq(orderLogs.orderId, id));
  });
};

export default ordersRoutes;
