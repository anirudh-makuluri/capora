ALTER TABLE `purchases` ADD `payment_lease_until` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchases` ADD `payment_lease_id` text;