CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`entity_id` text,
	`correlation_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activity_user_idx` ON `activity` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_token_hash_unique` ON `agents` (`token_hash`);--> statement-breakpoint
CREATE INDEX `agents_user_idx` ON `agents` (`user_id`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_purchase_id_unique` ON `approvals` (`purchase_id`);--> statement-breakpoint
CREATE TABLE `billing_setups` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`setup_token_id` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`pricing_unit` text NOT NULL,
	`input_schema` text NOT NULL,
	`output_schema` text NOT NULL,
	`endpoint` text NOT NULL,
	`http_method` text DEFAULT 'POST' NOT NULL,
	`secret_encrypted` text,
	`auth_header` text DEFAULT 'Authorization' NOT NULL,
	`dataset_key` text,
	`expected_latency_ms` integer NOT NULL,
	`avg_latency_ms` integer DEFAULT 0 NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`baseline_reliability` real DEFAULT 99 NOT NULL,
	`tags` text NOT NULL,
	`async` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`synthetic` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`documentation_url` text,
	`availability` real DEFAULT 0.99 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `capabilities_category_idx` ON `capabilities` (`category`,`enabled`);--> statement-breakpoint
CREATE INDEX `capabilities_provider_idx` ON `capabilities` (`provider_id`);--> statement-breakpoint
CREATE TABLE `invocations` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`capability_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`status` text NOT NULL,
	`input` text NOT NULL,
	`latency_ms` integer,
	`result` text,
	`artifact_key` text,
	`error` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`capability_id`) REFERENCES `capabilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invocations_purchase_id_unique` ON `invocations` (`purchase_id`);--> statement-breakpoint
CREATE INDEX `invocations_agent_idx` ON `invocations` (`agent_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`invocation_id` text NOT NULL,
	`status` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`result` text,
	`error` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`invocation_id`) REFERENCES `invocations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_invocation_id_unique` ON `jobs` (`invocation_id`);--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`reputation` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`capability_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`status` text NOT NULL,
	`payment_mode` text NOT NULL,
	`order_id` text,
	`capture_id` text,
	`approval_url` text,
	`error` text,
	`reason` text,
	`budget_day` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`capability_id`) REFERENCES `capabilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_quote_id_unique` ON `purchases` (`quote_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_order_id_unique` ON `purchases` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_capture_id_unique` ON `purchases` (`capture_id`);--> statement-breakpoint
CREATE INDEX `purchases_budget_idx` ON `purchases` (`agent_id`,`budget_day`,`status`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`capability_id` text NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`input` text NOT NULL,
	`input_hash` text NOT NULL,
	`capability_version` integer NOT NULL,
	`reason` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`capability_id`) REFERENCES `capabilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `quotes_agent_idx` ON `quotes` (`agent_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`capability_id` text NOT NULL,
	`user_id` text NOT NULL,
	`rating` integer NOT NULL,
	`body` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`capability_id`) REFERENCES `capabilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_user_capability_idx` ON `reviews` (`user_id`,`capability_id`);--> statement-breakpoint
CREATE TABLE `spending_policies` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`daily_budget_cents` integer DEFAULT 2500 NOT NULL,
	`auto_approve_cents` integer DEFAULT 50 NOT NULL,
	`max_transaction_cents` integer DEFAULT 1000 NOT NULL,
	`autonomous_enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`type` text DEFAULT 'capture' NOT NULL,
	`status` text NOT NULL,
	`order_id` text,
	`capture_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_purchase_id_unique` ON `transactions` (`purchase_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`vault_encrypted` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);