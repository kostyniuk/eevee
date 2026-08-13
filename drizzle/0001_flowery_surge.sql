CREATE TYPE "public"."review_notification_status" AS ENUM('pending', 'delivering', 'delivered');--> statement-breakpoint
ALTER TABLE "review_records" ADD COLUMN "notification_status" "review_notification_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "review_records" ADD COLUMN "notification_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_records" ADD COLUMN "notification_delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_records" ADD COLUMN "slack_channel_id" text;--> statement-breakpoint
ALTER TABLE "review_records" ADD COLUMN "slack_message_ts" text;--> statement-breakpoint
CREATE INDEX "review_records_notification_delivery_idx" ON "review_records" USING btree ("notification_status","notification_attempted_at","created_at");--> statement-breakpoint
ALTER TABLE "review_records" ADD CONSTRAINT "review_records_notification_delivery_check" CHECK (("review_records"."notification_status" = 'pending' and "review_records"."notification_attempted_at" is null and "review_records"."notification_delivered_at" is null and "review_records"."slack_channel_id" is null and "review_records"."slack_message_ts" is null)
        or ("review_records"."notification_status" = 'delivering' and "review_records"."notification_attempted_at" is not null and "review_records"."notification_delivered_at" is null and "review_records"."slack_channel_id" is null and "review_records"."slack_message_ts" is null)
        or ("review_records"."notification_status" = 'delivered' and "review_records"."notification_attempted_at" is not null and "review_records"."notification_delivered_at" is not null and "review_records"."slack_channel_id" is not null and "review_records"."slack_message_ts" is not null));