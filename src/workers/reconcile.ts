import { eq, and, lt, sql, or } from 'drizzle-orm';
import { orders } from '../db/schema.js';
import { FastifyBaseLogger } from 'fastify';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema.js';

type DbType = NodePgDatabase<typeof schema>;

export const startReconcileWorker = (db: DbType, logger: FastifyBaseLogger) => {
  const RECONCILE_INTERVAL = 30000; // 30 seconds
  const CLAIM_TIMEOUT = 60000; // 1 minute to start after claim
  const HEARTBEAT_TIMEOUT = 120000; // 2 minutes without heartbeat

  const reconcile = async () => {
    const now = new Date();
    
    try {
      // 1. Requeue CLAIMED expired (didn't start in time)
      const expiredClaimed = await db.update(orders)
        .set({ 
          status: 'QUEUED', 
          runnerId: null, 
          claimedAt: null,
          statusReason: 'Claim timeout: runner failed to start execution',
          updatedAt: now 
        })
        .where(and(
          eq(orders.status, 'CLAIMED'),
          lt(orders.claimedAt, new Date(now.getTime() - CLAIM_TIMEOUT))
        ))
        .returning();
      
      for (const order of expiredClaimed) {
        logger.warn({
          orderId: order.id,
          runnerId: order.runnerId,
          playbookKey: order.playbookKey,
          previousStatus: 'CLAIMED',
          targetStatus: 'QUEUED',
          reason: 'Claim timeout'
        }, `Order ${order.id} requeued: runner failed to start in time`);
      }

      // 2. Mark STALE RUNNING without heartbeat
      const staleRunning = await db.update(orders)
        .set({ 
          status: 'STALE', 
          statusReason: 'Heartbeat missing: runner might be offline',
          updatedAt: now 
        })
        .where(and(
          eq(orders.status, 'RUNNING'),
          lt(orders.lastHeartbeatAt, new Date(now.getTime() - HEARTBEAT_TIMEOUT))
        ))
        .returning();

      for (const order of staleRunning) {
        logger.warn({
          orderId: order.id,
          runnerId: order.runnerId,
          playbookKey: order.playbookKey,
          previousStatus: 'RUNNING',
          targetStatus: 'STALE',
          reason: 'Heartbeat missing'
        }, `Order ${order.id} marked as STALE: no heartbeat received`);
      }

      // 3. Apply TIMEOUT
      const timedOut = await db.update(orders)
        .set({ 
          status: 'TIMED_OUT', 
          statusReason: 'Execution timeout exceeded',
          completedAt: now,
          updatedAt: now 
        })
        .where(and(
          eq(orders.status, 'RUNNING'),
          sql`EXTRACT(EPOCH FROM (${now} - ${orders.startedAt})) > ${orders.timeoutSec}`
        ))
        .returning();

      for (const order of timedOut) {
        logger.error({
          orderId: order.id,
          runnerId: order.runnerId,
          playbookKey: order.playbookKey,
          previousStatus: 'RUNNING',
          targetStatus: 'TIMED_OUT',
          reason: 'Execution timeout'
        }, `Order ${order.id} TIMED_OUT: execution exceeded ${order.timeoutSec}s`);
      }

      // 4. Handle Retries for FAILED/STALE/TIMED_OUT
      // We only retry if attempt < maxAttempts
      const toRetry = await db.update(orders)
        .set({ 
          status: 'QUEUED', 
          runnerId: null,
          attempt: sql`${orders.attempt} + 1`,
          statusReason: sql`CONCAT('Retry attempt ', ${orders.attempt} + 1)`,
          updatedAt: now 
        })
        .where(and(
          or(eq(orders.status, 'FAILED'), eq(orders.status, 'STALE'), eq(orders.status, 'TIMED_OUT')),
          sql`${orders.attempt} < ${orders.maxAttempts}`
        ))
        .returning();

      for (const order of toRetry) {
        logger.info({
          orderId: order.id,
          runnerId: null,
          playbookKey: order.playbookKey,
          previousStatus: order.status,
          targetStatus: 'QUEUED',
          attempt: order.attempt,
          maxAttempts: order.maxAttempts
        }, `Order ${order.id} scheduled for retry (Attempt ${order.attempt}/${order.maxAttempts})`);
      }

      // 5. Finalize FAILED for those who reached maxAttempts
      const finalFailed = await db.update(orders)
        .set({
          status: 'FAILED',
          statusReason: 'Max retry attempts reached',
          updatedAt: now
        })
        .where(and(
          or(eq(orders.status, 'STALE'), eq(orders.status, 'TIMED_OUT')),
          sql`${orders.attempt} >= ${orders.maxAttempts}`
        ))
        .returning();

      for (const order of finalFailed) {
        logger.error({
          orderId: order.id,
          runnerId: order.runnerId,
          playbookKey: order.playbookKey,
          previousStatus: order.status,
          targetStatus: 'FAILED',
          reason: 'Max attempts reached'
        }, `Order ${order.id} permanently FAILED: max retry attempts reached`);
      }

    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({
        err: error,
        stack: error.stack,
        context: 'reconcile_worker_loop',
        timestamp: now.toISOString()
      }, `Reconcile worker error: ${error.message}`);
    }
  };

  logger.info('Reconcile worker started');
  const interval = setInterval(() => {
    reconcile().catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ err: error }, `Fatal error in reconcile interval: ${error.message}`);
    });
  }, RECONCILE_INTERVAL);
  
  return () => {
    logger.info('Reconcile worker stopping');
    clearInterval(interval);
  };
};
