import { pgTable, uuid, text, timestamp, jsonb, integer, pgEnum, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const runnerStatusEnum = pgEnum('runner_status', ['ONLINE', 'OFFLINE', 'DISABLED']);
export const playbookCategoryEnum = pgEnum('playbook_category', ['BASE', 'STANDARD', 'ADVANCED', 'CUSTOM']);
export const riskLevelEnum = pgEnum('risk_level', ['LOW', 'MEDIUM', 'HIGH']);
export const orderStatusEnum = pgEnum('order_status', [
  'QUEUED', 'CLAIMED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'STALE', 'TIMED_OUT'
]);
export const logLevelEnum = pgEnum('log_level', ['debug', 'info', 'warn', 'error']);

export const runners = pgTable('runners', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: runnerStatusEnum('status').default('OFFLINE').notNull(),
  lastHeartbeatAt: timestamp('last_heartbeat_at'),
  scopes: text('scopes').array().notNull().default([]),
  capabilities: jsonb('capabilities').notNull().default({}),
  tokenHash: text('token_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const servers = pgTable('servers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  runnerId: uuid('runner_id').references(() => runners.id),
  metadata: jsonb('metadata').notNull().default({}),
  tags: text('tags').array().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const playbooks = pgTable('playbooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').unique().notNull(),
  name: text('name').notNull(),
  category: playbookCategoryEnum('category').notNull(),
  riskLevel: riskLevelEnum('risk_level').notNull(),
  requiresScopes: text('requires_scopes').array().notNull().default([]),
  schemaVersion: text('schema_version').notNull(),
  spec: jsonb('spec').notNull().default({}),
  isPublished: text('is_published').notNull().default('false'), // Using text for boolean-like behavior if needed, or just boolean
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  serverId: uuid('server_id').references(() => servers.id).notNull(),
  runnerId: uuid('runner_id').references(() => runners.id),
  playbookKey: text('playbook_key').references(() => playbooks.key).notNull(),
  action: text('action').notNull(),
  payload: jsonb('payload').notNull().default({}),
  status: orderStatusEnum('status').default('QUEUED').notNull(),
  statusReason: text('status_reason'),
  claimedAt: timestamp('claimed_at'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  lastHeartbeatAt: timestamp('last_heartbeat_at'),
  timeoutSec: integer('timeout_sec').default(3600).notNull(),
  attempt: integer('attempt').default(0).notNull(),
  maxAttempts: integer('max_attempts').default(1).notNull(),
  idempotencyKey: text('idempotency_key').unique().notNull(),
  dedupeKey: text('dedupe_key'), // Handled by unique index for active orders
  report: jsonb('report'),
  errorCode: text('error_code'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    orderIdIdx: index('order_id_idx').on(table.id),
    statusIdx: index('status_idx').on(table.status),
    runnerIdIdx: index('runner_id_idx').on(table.runnerId),
    // Unique index for dedupe_key on active orders
    activeDedupeIdx: uniqueIndex('active_dedupe_idx').on(table.dedupeKey).where(
      sql`status IN ('QUEUED', 'CLAIMED', 'RUNNING')`
    ),
  };
});

export const orderLogs = pgTable('order_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').references(() => orders.id).notNull(),
  runnerId: uuid('runner_id').references(() => runners.id),
  ts: timestamp('ts').defaultNow().notNull(),
  level: logLevelEnum('level').notNull(),
  message: text('message').notNull(),
  meta: jsonb('meta').notNull().default({}),
}, (table) => {
  return {
    orderIdIdx: index('log_order_id_idx').on(table.orderId),
  };
});
