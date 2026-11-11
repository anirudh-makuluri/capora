CREATE TABLE `bank_work_leases` (
	`name` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_expiry_idx` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `auth_verifications_expiry_idx` ON `auth_verifications` (`expires_at`);--> statement-breakpoint
CREATE INDEX `bank_escrows_state_deadline_idx` ON `bank_escrows` (`state`,`deadline`);--> statement-breakpoint
CREATE INDEX `bank_events_source_block_idx` ON `bank_events` (`source`,CAST("block_number" AS INTEGER));--> statement-breakpoint
CREATE INDEX `bank_strategy_due_idx` ON `bank_strategy_schedules` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `invocations_status_created_idx` ON `invocations` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `providers_user_idx` ON `providers` (`user_id`);--> statement-breakpoint
CREATE INDEX `purchases_status_created_idx` ON `purchases` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `purchases_agent_created_idx` ON `purchases` (`agent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `rate_limits_expiry_idx` ON `rate_limits` (`expires_at`);--> statement-breakpoint
CREATE INDEX `transactions_provider_status_idx` ON `transactions` (`provider_id`,`status`);