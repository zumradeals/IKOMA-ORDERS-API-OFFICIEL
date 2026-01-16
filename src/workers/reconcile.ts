import { eq, and, lt, sql, or } from 'drizzle-orm';
import { orders } from '../db/schema.js';

export const startReconcileWorker = (db: any, logger: any) => {
  const RECONCILE_INTERVAL = 30000; // 30 seconds
  const CLAIM_TIMEOUT = 60000; // 1 minute to start after claim
  const HEARTBEAT_TIMEOUT = 120000; // 2 minutes without heartbeat

  const reconcile = async () => {
    try {
      const now = new Date();

      // 1. Requeue CLAIMED expired (didn't start in time)
      const expiredClaimed = await db.update(orders)
        .set({ 
          status: 'QUEUED', 
          runnerId: null, 
          claimedAt: null,
          updatedAt: now 
        })
        .where(and(
          eq(orders.status, 'CLAIMED'),
          lt(orders.claimedAt, new Date(now.getTime() - CLAIM_TIMEOUT))
        ))
        .returning();
      
      if (expiredClaimed.length > 0) {
        logger.info(`Requeued ${expiredClaimed.length} expired CLAIMED orders`);
      }

      // 2. Mark STALE RUNNING without heartbeat
      const staleRunning = await db.update(orders)
        .set({ 
          status: 'STALE', 
          statusReason: 'Heartbeat missing',
          updatedAt: now 
        })
        .where(and(
          eq(orders.status, 'RUNNING'),
          lt(orders.lastHeartbeatAt, new Date(now.getTime() - HEARTBEAT_TIMEOUT))
        ))
        .returning();

      if (staleRunning.length > 0) {
        logger.info(`Marked ${staleRunning.length} RUNNING orders as STALE`);
      }

      // 3. Apply TIMEOUT
      // We check if (now - startedAt) > timeoutSec
      const timedOut = await db.update(orders)
        .set({ 
          status: 'TIMED_OUT', 
          statusReason: 'Execution timeout',
          completedAt: now,
          updatedAt: now 
        })
        .where(and(
          eq(orders.status, 'RUNNING'),
          sql`EXTRACT(EPOCH FROM (${now} - ${orders.startedAt})) > ${orders.timeoutSec}`
        ))
        .returning();

      if (timedOut.length > 0) {
        logger.info(`Timed out ${timedOut.length} orders`);
      }

      // 4. Handle Retries for FAILED/STALE/TIMED_OUT
      const toRetry = await db.update(orders)
        .set({ 
          status: 'QUEUED', 
          runnerId: null,
          attempt: sql`${orders.attempt} + 1`,
          updatedAt: now 
        })
        .where(and(
          or(eq(orders.status, 'FAILED'), eq(orders.status, 'STALE'), eq(orders.status, 'TIMED_OUT')),
          sql`${orders.attempt} < ${orders.maxAttempts}`
        ))
        .returning();

      if (toRetry.length > 0) {
        logger.info(`Retrying ${toRetry.length} orders`);
      }

    } catch (err) {
      logger.error('Reconcile worker error:', err);
    }
  };

  logger.info('Reconcile worker started');
  const interval = setInterval(reconcile, RECONCILE_INTERVAL);
  
  return () => clearInterval(interval);
};
