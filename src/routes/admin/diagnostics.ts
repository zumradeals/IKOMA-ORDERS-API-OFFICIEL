import { FastifyPluginAsync } from 'fastify';
import { orders, runners } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';

const diagnosticsRoutes: FastifyPluginAsync = async (fastify) => {
  const db = (fastify as any).db;

  fastify.get('/diagnostics', async () => {
    const now = new Date();

    const [{ queuedCount }] = await db.select({ queuedCount: sql<number>`count(*)` })
      .from(orders)
      .where(eq(orders.status, 'QUEUED'));

    const [{ runningCount }] = await db.select({ runningCount: sql<number>`count(*)` })
      .from(orders)
      .where(eq(orders.status, 'RUNNING'));

    const runnerRows = await db.select({
      id: runners.id,
      name: runners.name,
      lastHeartbeatAt: runners.lastHeartbeatAt,
      status: runners.status,
    }).from(runners);

    const runnerList = runnerRows.map((runner) => {
      const isOnline = !!runner.lastHeartbeatAt
        && now.getTime() - runner.lastHeartbeatAt.getTime() <= 60_000;

      return {
        id: runner.id,
        name: runner.name,
        lastSeen: runner.lastHeartbeatAt,
        status: isOnline ? 'ONLINE' : 'OFFLINE',
        ping: isOnline ? 'ok' : 'offline',
      };
    });

    return {
      db: 'ok',
      orders: {
        queued: Number(queuedCount ?? 0),
        running: Number(runningCount ?? 0),
      },
      runners: runnerList,
      ping: {
        ok: true,
        checkedAt: now,
      },
    };
  });
};

export default diagnosticsRoutes;
