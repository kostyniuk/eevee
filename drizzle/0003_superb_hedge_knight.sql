ALTER TABLE "review_records" ADD COLUMN "summary" text;--> statement-breakpoint
UPDATE "review_records" SET "summary" = "verdict" WHERE "summary" IS NULL;--> statement-breakpoint
ALTER TABLE "review_records" ALTER COLUMN "summary" SET NOT NULL;