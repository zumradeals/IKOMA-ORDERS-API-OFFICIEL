import { FastifyPluginAsync } from 'fastify';
import { orders, orderLogs, playbooks, runners, servers } from '../../db/schema.js';
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
  dryRun: z.boolean().optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const ordersRoutes: FastifyPluginAsync = async (fastify) => {
  const db = (fastify as any).db;
  const reportContract = {
    version: 'v2',
    compatibleVersions: ['v1', 'v2'],
    summary: 'string',
    durationMs: 0,
    steps: [],
    errors: [],
  };

  fastify.get('/orders', async () => {
    return await db.select().from(orders);
  });

  fastify.get('/orders/:id', async (request: any, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    
    const report = order.report as any;
    
    return {
      id: order.id,
      status: order.status,
      serverId: order.serverId,
      runnerId: order.runnerId,
      playbookKey: order.playbookKey,
      action: order.action,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      reportContractVersion: report?.version || null,
      reportSummary: report?.summary || null,
    };
  });

  fastify.post('/orders', async (request, reply) => {
    const body = orderCreateSchema.parse(request.body);
    const now = new Date();

    // Intercept SYSTEM.diagnostics
    if (body.playbookKey === 'SYSTEM.diagnostics') {
      return await fastify.inject({
        method: 'POST',
        url: '/v1/orders/system.diagnostics',
        payload: body,
        headers: request.headers as any
      }).then(res => JSON.parse(res.body));
    }

    const [server] = await db.select({ runnerId: servers.runnerId })
      .from(servers)
      .where(eq(servers.id, body.serverId))
      .limit(1);

    if (!server) {
      return reply.code(400).send({ error: 'Server not found', reason: 'server_not_found' });
    }

    if (!server.runnerId) {
      return reply.code(400).send({ error: 'Server has no runner', reason: 'runner_not_assigned' });
    }

    if (body.dryRun) {
      const [playbook] = await db.select({ key: playbooks.key })
        .from(playbooks)
        .where(eq(playbooks.key, body.playbookKey))
        .limit(1);

      if (!playbook) {
        return reply.code(400).send({ error: 'Playbook not found', reason: 'playbook_not_found' });
      }

      const [runner] = await db.select({ id: runners.id, lastHeartbeatAt: runners.lastHeartbeatAt })
        .from(runners)
        .where(eq(runners.id, server.runnerId))
        .limit(1);

      const isOnline = !!runner?.lastHeartbeatAt
        && now.getTime() - runner.lastHeartbeatAt.getTime() <= 60_000;

      if (!runner) {
        return reply.code(400).send({ error: 'Runner not found', reason: 'runner_not_found' });
      }

      if (!isOnline) {
        return reply.code(400).send({ error: 'Runner offline', reason: 'runner_offline' });
      }

      return {
        plan: {
          ok: true,
          dryRun: true,
          serverId: body.serverId,
          runnerId: server.runnerId,
          playbookKey: body.playbookKey,
          action: body.action,
        },
      };
    }

    // Check idempotency
    const [existing] = await db.select().from(orders).where(eq(orders.idempotencyKey, body.idempotencyKey)).limit(1);
    if (existing) {
      return {
        order: {
          id: existing.id,
          status: existing.status,
          serverId: existing.serverId,
          runnerId: existing.runnerId,
          playbookKey: existing.playbookKey,
          action: existing.action,
          createdAt: existing.createdAt,
        },
        reportContract,
      };
    }

    const { dryRun, ...orderInput } = body;

    const [newOrder] = await db.insert(orders).values({
      ...orderInput,
      runnerId: server.runnerId,
      payload: orderInput.payload ?? {},
      status: 'QUEUED',
      updatedAt: now,
    }).returning();

    return {
      order: {
        id: newOrder.id,
        status: newOrder.status,
        serverId: newOrder.serverId,
        runnerId: newOrder.runnerId,
        playbookKey: newOrder.playbookKey,
        action: newOrder.action,
        createdAt: newOrder.createdAt,
      },
      reportContract,
    };
  });

  fastify.post('/orders/:id/cancel', async (request: any, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const [updatedOrder] = await db.update(orders)
      .set({ status: 'CANCELED', updatedAt: new Date() })
      .where(and(eq(orders.id, id), eq(orders.status, 'QUEUED')))
      .returning();

    if (!updatedOrder) {
      const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!order) {
        return reply.code(404).send({ error: 'Order not found' });
      }
      return reply.code(400).send({ 
        error: 'Order cannot be canceled', 
        reason: 'invalid_status', 
        currentStatus: order.status 
      });
    }
    return updatedOrder;
  });

  fastify.get('/orders/:id/logs', async (request: any, reply) => {
    const { id } = idParamSchema.parse(request.params);
    return await db.select().from(orderLogs).where(eq(orderLogs.orderId, id));
  });
};

export default ordersRoutes;
