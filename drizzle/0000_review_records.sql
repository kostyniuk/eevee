CREATE TYPE "public"."eval_shuffle_order" AS ENUM('before_first', 'after_first');--> statement-breakpoint
CREATE TYPE "public"."eval_vote_choice" AS ENUM('before', 'after');--> statement-breakpoint
CREATE TYPE "public"."feedback_kind" AS ENUM('vote', 'text');--> statement-breakpoint
CREATE TYPE "public"."feedback_source" AS ENUM('github', 'slack');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('active', 'superseded');--> statement-breakpoint
CREATE TABLE "eval_pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_record_id" uuid NOT NULL,
	"before_diff" jsonb NOT NULL,
	"after_diff" jsonb NOT NULL,
	"shuffle_order" "eval_shuffle_order" NOT NULL,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_id" uuid NOT NULL,
	"choice" "eval_vote_choice" NOT NULL,
	"voter" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_record_id" uuid NOT NULL,
	"source" "feedback_source" NOT NULL,
	"kind" "feedback_kind" NOT NULL,
	"finding_id" uuid,
	"author" text NOT NULL,
	"body" text,
	"value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_turn_id" text NOT NULL,
	"repository_id" bigint NOT NULL,
	"repository" text NOT NULL,
	"pull_request_number" integer NOT NULL,
	"reviewed_commit_sha" varchar(40) NOT NULL,
	"model" text NOT NULL,
	"instructions_version" varchar(64) NOT NULL,
	"instructions_source" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"safety_rating" smallint NOT NULL,
	"verdict" text NOT NULL,
	"findings" jsonb NOT NULL,
	"status" "review_status" DEFAULT 'active' NOT NULL,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_records_safety_rating_check" CHECK ("review_records"."safety_rating" between 0 and 5),
	CONSTRAINT "review_records_criteria_object_check" CHECK (jsonb_typeof("review_records"."criteria") = 'object'),
	CONSTRAINT "review_records_security_criterion_check" CHECK (
    coalesce(jsonb_typeof("review_records"."criteria" #> '{security}') = 'object', false)
    and case
      when jsonb_typeof("review_records"."criteria" #> '{security,rating}') = 'number'
      then ("review_records"."criteria" #>> '{security,rating}')::numeric between 0 and 5
        and ("review_records"."criteria" #>> '{security,rating}')::numeric = trunc(("review_records"."criteria" #>> '{security,rating}')::numeric)
      else false
    end
    and coalesce(jsonb_typeof("review_records"."criteria" #> '{security,reasoning}') = 'string', false)
  ),
	CONSTRAINT "review_records_blast_radius_criterion_check" CHECK (
    coalesce(jsonb_typeof("review_records"."criteria" #> '{blastRadius}') = 'object', false)
    and case
      when jsonb_typeof("review_records"."criteria" #> '{blastRadius,rating}') = 'number'
      then ("review_records"."criteria" #>> '{blastRadius,rating}')::numeric between 0 and 5
        and ("review_records"."criteria" #>> '{blastRadius,rating}')::numeric = trunc(("review_records"."criteria" #>> '{blastRadius,rating}')::numeric)
      else false
    end
    and coalesce(jsonb_typeof("review_records"."criteria" #> '{blastRadius,reasoning}') = 'string', false)
  ),
	CONSTRAINT "review_records_correctness_criterion_check" CHECK (
    coalesce(jsonb_typeof("review_records"."criteria" #> '{correctness}') = 'object', false)
    and case
      when jsonb_typeof("review_records"."criteria" #> '{correctness,rating}') = 'number'
      then ("review_records"."criteria" #>> '{correctness,rating}')::numeric between 0 and 5
        and ("review_records"."criteria" #>> '{correctness,rating}')::numeric = trunc(("review_records"."criteria" #>> '{correctness,rating}')::numeric)
      else false
    end
    and coalesce(jsonb_typeof("review_records"."criteria" #> '{correctness,reasoning}') = 'string', false)
  ),
	CONSTRAINT "review_records_data_safety_criterion_check" CHECK (
    coalesce(jsonb_typeof("review_records"."criteria" #> '{dataSafety}') = 'object', false)
    and case
      when jsonb_typeof("review_records"."criteria" #> '{dataSafety,rating}') = 'number'
      then ("review_records"."criteria" #>> '{dataSafety,rating}')::numeric between 0 and 5
        and ("review_records"."criteria" #>> '{dataSafety,rating}')::numeric = trunc(("review_records"."criteria" #>> '{dataSafety,rating}')::numeric)
      else false
    end
    and coalesce(jsonb_typeof("review_records"."criteria" #> '{dataSafety,reasoning}') = 'string', false)
  ),
	CONSTRAINT "review_records_test_coverage_criterion_check" CHECK (
    coalesce(jsonb_typeof("review_records"."criteria" #> '{testCoverage}') = 'object', false)
    and case
      when jsonb_typeof("review_records"."criteria" #> '{testCoverage,rating}') = 'number'
      then ("review_records"."criteria" #>> '{testCoverage,rating}')::numeric between 0 and 5
        and ("review_records"."criteria" #>> '{testCoverage,rating}')::numeric = trunc(("review_records"."criteria" #>> '{testCoverage,rating}')::numeric)
      else false
    end
    and coalesce(jsonb_typeof("review_records"."criteria" #> '{testCoverage,reasoning}') = 'string', false)
  ),
	CONSTRAINT "review_records_readability_criterion_check" CHECK (
    coalesce(jsonb_typeof("review_records"."criteria" #> '{readability}') = 'object', false)
    and case
      when jsonb_typeof("review_records"."criteria" #> '{readability,rating}') = 'number'
      then ("review_records"."criteria" #>> '{readability,rating}')::numeric between 0 and 5
        and ("review_records"."criteria" #>> '{readability,rating}')::numeric = trunc(("review_records"."criteria" #>> '{readability,rating}')::numeric)
      else false
    end
    and coalesce(jsonb_typeof("review_records"."criteria" #> '{readability,reasoning}') = 'string', false)
  ),
	CONSTRAINT "review_records_superseded_by_check" CHECK (("review_records"."status" = 'active' and "review_records"."superseded_by_id" is null) or ("review_records"."status" = 'superseded' and "review_records"."superseded_by_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "eval_pairs" ADD CONSTRAINT "eval_pairs_review_record_id_review_records_id_fk" FOREIGN KEY ("review_record_id") REFERENCES "public"."review_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_votes" ADD CONSTRAINT "eval_votes_pair_id_eval_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."eval_pairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_review_record_id_review_records_id_fk" FOREIGN KEY ("review_record_id") REFERENCES "public"."review_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_records" ADD CONSTRAINT "review_records_superseded_by_id_review_records_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."review_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_pairs_review_record_idx" ON "eval_pairs" USING btree ("review_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_votes_pair_voter_unique" ON "eval_votes" USING btree ("pair_id","voter");--> statement-breakpoint
CREATE INDEX "eval_votes_pair_idx" ON "eval_votes" USING btree ("pair_id");--> statement-breakpoint
CREATE INDEX "feedback_review_record_idx" ON "feedback" USING btree ("review_record_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_records_source_turn_id_unique" ON "review_records" USING btree ("source_turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_records_one_active_per_pr" ON "review_records" USING btree ("repository_id","pull_request_number") WHERE "review_records"."status" = 'active';--> statement-breakpoint
CREATE INDEX "review_records_pr_created_idx" ON "review_records" USING btree ("repository_id","pull_request_number","created_at");--> statement-breakpoint
CREATE INDEX "review_records_security_rating_idx" ON "review_records" USING btree ((("criteria" #>> '{security,rating}')::smallint));--> statement-breakpoint
CREATE INDEX "review_records_blast_radius_rating_idx" ON "review_records" USING btree ((("criteria" #>> '{blastRadius,rating}')::smallint));--> statement-breakpoint
CREATE INDEX "review_records_correctness_rating_idx" ON "review_records" USING btree ((("criteria" #>> '{correctness,rating}')::smallint));--> statement-breakpoint
CREATE INDEX "review_records_data_safety_rating_idx" ON "review_records" USING btree ((("criteria" #>> '{dataSafety,rating}')::smallint));--> statement-breakpoint
CREATE INDEX "review_records_test_coverage_rating_idx" ON "review_records" USING btree ((("criteria" #>> '{testCoverage,rating}')::smallint));--> statement-breakpoint
CREATE INDEX "review_records_readability_rating_idx" ON "review_records" USING btree ((("criteria" #>> '{readability,rating}')::smallint));