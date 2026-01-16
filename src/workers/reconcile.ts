import { eq, and, lt, sql, or } from 'drizzle-orm';
import { orders } from '../db/schema.js';
import { FastifyBaseLogger } from 'fastify';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema.js';

type DbType = NodePgDatabase<typeof schema>;

export const startReconcileWorker = (db: DbType, logger: FastifyBaseLogger) => {
  const BASE_INTERVAL = 30000; // 30 seconds
  const BACKOFF_STEPS = [1000, 2000, 5000, 10000, 30000]; // Progressive backoff in ms
  const CLAIM_TIMEOUT = 60000;
  const HEARTBEAT_TIMEOUT = 120000;

  let currentBackoffIdx = -1;
  let isDbDown = false;
  let timeoutId: NodeJS.Timeout | null = null;

  const isDbError = (err: any): boolean => {
    const msg = String(err?.message || '').toUpperCase();
    const code = String(err?.code || '').toUpperCase();
    return (
      code === 'ECONNREFUSED' ||
      code === 'ETIMEDOUT' ||
      msg.includes('CONNECTION REFUSED') ||
      msg.includes('AGGREGATEERROR') ||
      msg.includes('DATABASE UNREACHABLE')
    );
  };

  const reconcile = async () => {
    const now = new Date();
    
    try {
      // 1. Requeue CLAIMED expired
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
        logger.warn({ orderId: order.id, context: 'reconcile_worker' }, `Order ${order.id} requeued: runner failed to start in time`);
      }

      // 2. Mark STALE RUNNING
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
        logger.warn({ orderId: order.id, context: 'reconcile_worker' }, `Order ${order.id} marked as STALE: no heartbeat received`);
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
        logger.error({ orderId: order.id, context: 'reconcile_worker' }, `Order ${order.id} TIMED_OUT: execution exceeded ${order.timeoutSec}s`);
      }

      // 4. Handle Retries
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
        logger.info({ orderId: order.id, context: 'reconcile_worker' }, `Order ${order.id} scheduled for retry (Attempt ${order.attempt}/${order.maxAttempts})`);
      }

      // 5. Finalize FAILED
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
        logger.error({ orderId: order.id, context: 'reconcile_worker' }, `Order ${order.id} permanently FAILED: max retry attempts reached`);
      }

      // Reset backoff on success
      if (isDbDown) {
        logger.info({ context: 'reconcile_worker_loop' }, 'Database connection restored. Resetting backoff.');
        isDbDown = false;
        currentBackoffIdx = -1;
      }

    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      
      if (isDbError(err)) {
        currentBackoffIdx = Math.min(currentBackoffIdx + 1, BACKOFF_STEPS.length - 1);
        const nextRetryInMs = BACKOFF_STEPS[currentBackoffIdx];
        
        const logPayload = {
          context: 'reconcile_worker_loop',
          errorCode: 'DB_UNREACHABLE',
          nextRetryInMs,
          attempt: currentBackoffIdx + 1,
          cause: error.message
        };

        if (!isDbDown) {
          // First time DB goes down, log with stack
          logger.error({ ...logPayload, stack: error.stack }, `Database unreachable. Starting backoff: ${error.message}`);
          isDbDown = true;
        } else {
          // Subsequent logs are summarized
          logger.warn(logPayload, `Database still unreachable. Retrying in ${nextRetryInMs}ms...`);
        }
        
        // Schedule next retry with backoff
        scheduleNext(nextRetryInMs);
        return;
      }

      logger.error({
        err: error,
        stack: error.stack,
        context: 'reconcile_worker_loop'
      }, `Reconcile worker unexpected error: ${error.message}`);
    }

    // Schedule next regular run
    scheduleNext(BASE_INTERVAL);
  };

  const scheduleNext = (delay: number) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      reconcile().catch(err => {
        logger.error({ err }, 'Fatal error in reconcile execution');
      });
    }, delay);
  };

  logger.info('Reconcile worker started');
  scheduleNext(1000); // Initial start
  
  return () => {
    logger.info('Reconcile worker stopping');
    if (timeoutId) clearTimeout(timeoutId);
  };
};
