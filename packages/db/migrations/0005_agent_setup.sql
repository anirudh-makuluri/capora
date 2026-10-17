CREATE TABLE `agent_setups` (
	`id` text PRIMARY KEY NOT NULL,
	`device_code_hash` text NOT NULL,
	`token_hash` text NOT NULL,
	`user_code` text NOT NULL,
	`name` text NOT NULL,
	`daily_budget_cents` integer NOT NULL,
	`auto_approve_cents` integer NOT NULL,
	`max_transaction_cents` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`agent_id` text NOT NULL,
	`user_id` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_setups_device_code_hash_unique` ON `agent_setups` (`device_code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_setups_token_hash_unique` ON `agent_setups` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_setups_agent_id_unique` ON `agent_setups` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_setups_expiry_idx` ON `agent_setups` (`expires_at`);
