CREATE TYPE "public"."log_level" AS ENUM('debug', 'info', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('QUEUED', 'CLAIMED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'STALE', 'TIMED_OUT');--> statement-breakpoint
CREATE TYPE "public"."playbook_category" AS ENUM('BASE', 'STANDARD', 'ADVANCED', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."runner_status" AS ENUM('ONLINE', 'OFFLINE', 'DISABLED');--> statement-breakpoint
CREATE TABLE "order_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"runner_id" uuid,
	"ts" timestamp DEFAULT now() NOT NULL,
	"level" "log_level" NOT NULL,
	"message" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"runner_id" uuid,
	"playbook_key" text NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "order_status" DEFAULT 'QUEUED' NOT NULL,
	"status_reason" text,
	"claimed_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"last_heartbeat_at" timestamp,
	"timeout_sec" integer DEFAULT 3600 NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text NOT NULL,
	"dedupe_key" text,
	"report" jsonb,
	"error_code" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "playbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"category" "playbook_category" NOT NULL,
	"risk_level" "risk_level" NOT NULL,
	"requires_scopes" text[] DEFAULT '{}' NOT NULL,
	"schema_version" text NOT NULL,
	"spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_published" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "playbooks_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "runners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "runner_status" DEFAULT 'OFFLINE' NOT NULL,
	"last_heartbeat_at" timestamp,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"runner_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_logs" ADD CONSTRAINT "order_logs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_logs" ADD CONSTRAINT "order_logs_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_playbook_key_playbooks_key_fk" FOREIGN KEY ("playbook_key") REFERENCES "public"."playbooks"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "log_order_id_idx" ON "order_logs" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_id_idx" ON "orders" USING btree ("id");--> statement-breakpoint
CREATE INDEX "status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "runner_id_idx" ON "orders" USING btree ("runner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "active_dedupe_idx" ON "orders" USING btree ("dedupe_key") WHERE status IN ('QUEUED', 'CLAIMED', 'RUNNING');