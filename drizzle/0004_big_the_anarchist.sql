CREATE TYPE "public"."review_close_status" AS ENUM('pending', 'processing', 'completed');--> statement-breakpoint
DROP INDEX "eval_pairs_review_record_idx";--> statement-breakpoint
ALTER TABLE "eval_pairs" ADD COLUMN "delivery_status" "review_notification_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_pairs" ADD COLUMN "delivery_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eval_pairs" ADD COLUMN "delivery_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eval_pairs" ADD COLUMN "slack_channel_id" text;--> statement-breakpoint
ALTER TABLE "eval_pairs" ADD COLUMN "slack_message_ts" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "review_records" ADD COLUMN "base_commit_sha" varchar(40);--> statement-breakpoint
ALTER TABLE "review_records" ADD COLUMN "close_status" "review_close_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "review_records" ADD COLUMN "close_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_records" ADD COLUMN "close_processed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_pairs_review_record_unique" ON "eval_pairs" USING btree ("review_record_id");--> statement-breakpoint
CREATE INDEX "eval_pairs_delivery_idx" ON "eval_pairs" USING btree ("delivery_status","delivery_claimed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_external_id_unique" ON "feedback" USING btree ("external_id");