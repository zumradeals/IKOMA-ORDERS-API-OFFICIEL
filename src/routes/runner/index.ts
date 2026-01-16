import { FastifyPluginAsync } from 'fastify';
import { runners, orders, orderLogs } from '../../db/schema.js';
import { eq, and, isNull, or, asc } from 'drizzle-orm';
import { z } from 'zod';

const runnerRoutes: FastifyPluginAsync = async (fastify) => {
  const db = (fastify as any).db;
  fastify.addHook('preHandler', (fastify as any).verifyRunner);

  fastify.post('/runner/heartbeat', async (request: any) => {
    const runnerId = request.runner.id;
    const { status, capabilities } = z.object({
      status: z.enum(['ONLINE', 'OFFLINE']).optional(),
      capabilities: z.record(z.string(), z.any()).optional(),
    }).parse(request.body);

    await db.update(runners)
      .set({ 
        status: status || 'ONLINE', 
        capabilities, 
        lastHeartbeatAt: new Date(),
        updatedAt: new Date() 
      })
      .where(eq(runners.id, runnerId));

    return { ok: true };
  });

  fastify.post('/runner/orders/claim-next', async (request: any, reply) => {
    const runnerId = request.runner.id;
    
    // Atomic claim: find first QUEUED order for this runner or unassigned
    // Note: In a real high-concurrency environment, we'd use a transaction with SKIP LOCKED
    // For this implementation, we'll use a simple update with returning
    
    const [claimedOrder] = await db.update(orders)
      .set({ 
        status: 'CLAIMED', 
        runnerId, 
        claimedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(and(
        eq(orders.status, 'QUEUED'),
        or(eq(orders.runnerId, runnerId), isNull(orders.runnerId))
      ))
      .returning();

    if (!claimedOrder) {
      return reply.code(204).send();
    }

    return claimedOrder;
  });

  fastify.post('/runner/orders/:id/start', async (request: any, reply) => {
    const { id } = request.params;
    const runnerId = request.runner.id;

    const [startedOrder] = await db.update(orders)
      .set({ 
        status: 'RUNNING', 
        startedAt: new Date(),
        lastHeartbeatAt: new Date(),
        updatedAt: new Date() 
      })
      .where(and(
        eq(orders.id, id),
        eq(orders.runnerId, runnerId),
        eq(orders.status, 'CLAIMED')
      ))
      .returning();

    if (!startedOrder) {
      return reply.code(400).send({ error: 'Order cannot be started' });
    }
    return startedOrder;
  });

  fastify.post('/runner/orders/:id/heartbeat', async (request: any, reply) => {
    const { id } = request.params;
    const runnerId = request.runner.id;

    const [updatedOrder] = await db.update(orders)
      .set({ 
        lastHeartbeatAt: new Date(),
        updatedAt: new Date() 
      })
      .where(and(
        eq(orders.id, id),
        eq(orders.runnerId, runnerId),
        eq(orders.status, 'RUNNING')
      ))
      .returning();

    if (!updatedOrder) {
      return reply.code(400).send({ error: 'Order heartbeat failed' });
    }
    return { ok: true };
  });

  fastify.post('/runner/orders/:id/complete', async (request: any, reply) => {
    const { id } = request.params;
    const runnerId = request.runner.id;
    const body = z.object({
      report: z.object({
        version: z.literal('v1'),
        ok: z.boolean(),
        summary: z.string(),
        startedAt: z.string(),
        finishedAt: z.string(),
        steps: z.array(z.any()),
        artifacts: z.record(z.string(), z.any()),
        errors: z.array(z.any()),
      }),
    }).safeParse(request.body);

    if (!body.success) {
      await db.update(orders)
        .set({ 
          status: 'FAILED', 
          errorCode: 'INVALID_REPORT',
          completedAt: new Date(),
          updatedAt: new Date() 
        })
        .where(eq(orders.id, id));
      return reply.code(400).send({ error: 'Invalid report format' });
    }

    const status = body.data.report.ok ? 'SUCCEEDED' : 'FAILED';

    const [completedOrder] = await db.update(orders)
      .set({ 
        status, 
        report: body.data.report,
        completedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(and(
        eq(orders.id, id),
        eq(orders.runnerId, runnerId),
        eq(orders.status, 'RUNNING')
      ))
      .returning();

    if (!completedOrder) {
      return reply.code(400).send({ error: 'Order completion failed' });
    }
    return completedOrder;
  });

  fastify.post('/runner/logs/batch', async (request: any) => {
    const runnerId = request.runner.id;
    const logs = z.array(z.object({
      orderId: z.string().uuid(),
      ts: z.string().optional(),
      level: z.enum(['debug', 'info', 'warn', 'error']),
      message: z.string(),
      meta: z.record(z.string(), z.any()).optional(),
    })).parse(request.body);

    if (logs.length > 0) {
      await db.insert(orderLogs).values(logs.map(log => ({
        ...log,
        runnerId,
        ts: log.ts ? new Date(log.ts) : new Date(),
      })));
    }

    return { ok: true, count: logs.length };
  });
};

export default runnerRoutes;
