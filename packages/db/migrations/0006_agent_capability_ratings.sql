DROP INDEX `reviews_user_capability_idx`;--> statement-breakpoint
ALTER TABLE `reviews` ADD `agent_id` text REFERENCES agents(id);--> statement-breakpoint
ALTER TABLE `reviews` ADD `invocation_id` text REFERENCES invocations(id);--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_invocation_idx` ON `reviews` (`invocation_id`);--> statement-breakpoint
CREATE INDEX `reviews_capability_idx` ON `reviews` (`capability_id`);