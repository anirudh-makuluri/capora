CREATE TABLE `resource_usage` (
	`resource` text PRIMARY KEY NOT NULL,
	`usage_day` text DEFAULT '' NOT NULL,
	`writes` integer DEFAULT 0 NOT NULL,
	`reads` integer DEFAULT 0 NOT NULL,
	`reserved_bytes` integer DEFAULT 0 NOT NULL,
	`blocked` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
INSERT INTO `resource_usage` (`resource`) VALUES ('r2');
