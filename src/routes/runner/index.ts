import { FastifyPluginAsync } from 'fastify';
import { runners, orders, orderLogs } from '../../db/schema.js';
import { eq, and, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { ReportV1Schema } from '../../contracts/report.v1.js';
import { ReportV2Schema } from '../../contracts/report.v2.js';

const runnerRoutes: FastifyPluginAsync = async (fastify) => {
  const db = (fastify as any).db;
  fastify.addHook('preHandler', (fastify as any).verifyRunner);

  const idParamSchema = z.object({
    id: z.string().uuid(),
  });

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
    
    const claimedOrder = await db.transaction(async (tx: any) => {
      const [orderToClaim] = await tx.select({ id: orders.id })
        .from(orders)
        .where(and(
          eq(orders.status, 'QUEUED'),
          or(eq(orders.runnerId, runnerId), isNull(orders.runnerId))
        ))
        .orderBy(orders.createdAt)
        .limit(1)
        .for('update', { skipLocked: true });

      if (!orderToClaim) {
        return null;
      }

      const [updated] = await tx.update(orders)
        .set({ 
          status: 'CLAIMED', 
          runnerId, 
          claimedAt: new Date(),
          updatedAt: new Date() 
        })
        .where(eq(orders.id, orderToClaim.id))
        .returning();
      
      return updated;
    });

    if (!claimedOrder) {
      return reply.code(204).send();
    }

    return claimedOrder;
  });

  fastify.post('/runner/orders/:id/start', async (request: any, reply) => {
    const { id } = idParamSchema.parse(request.params);
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
      const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!order) {
        return reply.code(409).send({ error: 'Conflict', reason: 'order_not_found' });
      }
      if (order.runnerId !== runnerId) {
        return reply.code(409).send({ error: 'Conflict', reason: 'wrong_runner' });
      }
      return reply.code(409).send({ error: 'Conflict', reason: 'invalid_status', currentStatus: order.status });
    }
    return startedOrder;
  });

  fastify.post('/runner/orders/:id/heartbeat', async (request: any, reply) => {
    const { id } = idParamSchema.parse(request.params);
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
      const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!order) {
        return reply.code(409).send({ error: 'Conflict', reason: 'order_not_found' });
      }
      if (order.runnerId !== runnerId) {
        return reply.code(409).send({ error: 'Conflict', reason: 'wrong_runner' });
      }
      return reply.code(409).send({ error: 'Conflict', reason: 'invalid_status', currentStatus: order.status });
    }
    return { ok: true };
  });

  fastify.post('/runner/orders/:id/complete', async (request: any, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const runnerId = request.runner.id;
    
    const reportSchema = z.union([ReportV2Schema, ReportV1Schema]);
    const body = z.object({
      report: reportSchema,
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
      await db.insert(orderLogs).values({
        orderId: id,
        runnerId,
        level: 'error',
        message: 'Order failed: invalid report',
        ts: new Date(),
        meta: { errorCode: 'INVALID_REPORT' },
      });
      return reply.code(400).send({ error: 'Invalid report format', details: body.error.format() });
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
      const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!order) {
        return reply.code(409).send({ error: 'Conflict', reason: 'order_not_found' });
      }
      if (order.runnerId !== runnerId) {
        return reply.code(409).send({ error: 'Conflict', reason: 'wrong_runner' });
      }
      return reply.code(409).send({ error: 'Conflict', reason: 'invalid_status', currentStatus: order.status });
    }
    await db.insert(orderLogs).values({
      orderId: id,
      runnerId,
      level: status === 'SUCCEEDED' ? 'info' : 'error',
      message: `Order ${status.toLowerCase()}`,
      ts: new Date(),
      meta: { reportOk: body.data.report.ok },
    });
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
