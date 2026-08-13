import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import type { Review } from "./review-helper";

export const reviewStatus = pgEnum("review_status", ["active", "superseded"]);
export const reviewNotificationStatus = pgEnum("review_notification_status", [
  "pending",
  "delivering",
  "delivered",
]);
export const feedbackSource = pgEnum("feedback_source", ["github", "slack"]);
export const feedbackKind = pgEnum("feedback_kind", ["vote", "text"]);
export const evalShuffleOrder = pgEnum("eval_shuffle_order", ["before_first", "after_first"]);
export const evalVoteChoice = pgEnum("eval_vote_choice", ["before", "after"]);

type StoredFinding = Review["findings"][number] & { readonly id: string };
type DiffReference = {
  readonly repository: string;
  readonly baseSha: string;
  readonly headSha: string;
};

const criterionKeys = [
  ["security", "security"],
  ["blastRadius", "blast_radius"],
  ["correctness", "correctness"],
  ["dataSafety", "data_safety"],
  ["testCoverage", "test_coverage"],
  ["readability", "readability"],
] as const satisfies ReadonlyArray<readonly [keyof Review["criteria"], string]>;

export const reviewRecords = pgTable(
  "review_records",
  {
    id: uuid().primaryKey(),
    sourceTurnId: text("source_turn_id").notNull(),
    repositoryId: bigint("repository_id", { mode: "number" }).notNull(),
    repository: text().notNull(),
    pullRequestNumber: integer("pull_request_number").notNull(),
    reviewedCommitSha: varchar("reviewed_commit_sha", { length: 40 }).notNull(),
    model: text().notNull(),
    instructionsVersion: varchar("instructions_version", { length: 64 }).notNull(),
    instructionsSource: text("instructions_source").notNull(),
    criteria: jsonb().$type<Review["criteria"]>().notNull(),
    safetyRating: smallint("safety_rating").notNull(),
    verdict: text().notNull(),
    findings: jsonb().$type<readonly StoredFinding[]>().notNull(),
    status: reviewStatus().notNull().default("active"),
    supersededById: uuid("superseded_by_id").references((): AnyPgColumn => reviewRecords.id),
    notificationStatus: reviewNotificationStatus("notification_status")
      .notNull()
      .default("pending"),
    notificationAttemptedAt: timestamp("notification_attempted_at", { withTimezone: true }),
    notificationClaimedAt: timestamp("notification_claimed_at", { withTimezone: true }),
    notificationDeliveredAt: timestamp("notification_delivered_at", { withTimezone: true }),
    slackChannelId: text("slack_channel_id"),
    slackMessageTs: text("slack_message_ts"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("review_records_source_turn_id_unique").on(table.sourceTurnId),
    uniqueIndex("review_records_one_active_per_pr")
      .on(table.repositoryId, table.pullRequestNumber)
      .where(sql`${table.status} = 'active'`),
    index("review_records_pr_created_idx").on(
      table.repositoryId,
      table.pullRequestNumber,
      table.createdAt,
    ),
    index("review_records_notification_delivery_idx").on(
      table.notificationStatus,
      table.notificationClaimedAt,
      table.createdAt,
    ),
    ...criterionKeys.map(([key, name]) =>
      index(`review_records_${name}_rating_idx`).on(criterionRating(table.criteria, key)),
    ),
    check("review_records_safety_rating_check", sql`${table.safetyRating} between 0 and 5`),
    check("review_records_criteria_object_check", sql`jsonb_typeof(${table.criteria}) = 'object'`),
    ...criterionKeys.map(([key, name]) =>
      check(`review_records_${name}_criterion_check`, validCriterion(table.criteria, key)),
    ),
    check(
      "review_records_superseded_by_check",
      sql`(${table.status} = 'active' and ${table.supersededById} is null) or (${table.status} = 'superseded' and ${table.supersededById} is not null)`,
    ),
    check(
      "review_records_notification_delivery_check",
      sql`(${table.notificationStatus} = 'pending' and ${table.notificationAttemptedAt} is null and ${table.notificationClaimedAt} is null and ${table.notificationDeliveredAt} is null and ${table.slackChannelId} is null and ${table.slackMessageTs} is null)
        or (${table.notificationStatus} = 'delivering' and ${table.notificationAttemptedAt} is not null and ${table.notificationClaimedAt} is not null and ${table.notificationDeliveredAt} is null and ${table.slackChannelId} is null and ${table.slackMessageTs} is null)
        or (${table.notificationStatus} = 'delivered' and ${table.notificationAttemptedAt} is not null and ${table.notificationClaimedAt} is not null and ${table.notificationDeliveredAt} is not null and ${table.slackChannelId} is not null and ${table.slackMessageTs} is not null)`,
    ),
  ],
);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid().primaryKey().defaultRandom(),
    reviewRecordId: uuid("review_record_id")
      .notNull()
      .references(() => reviewRecords.id, { onDelete: "cascade" }),
    source: feedbackSource().notNull(),
    kind: feedbackKind().notNull(),
    findingId: uuid("finding_id"),
    author: text().notNull(),
    body: text(),
    value: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("feedback_review_record_idx").on(table.reviewRecordId, table.createdAt)],
);

export const evalPairs = pgTable(
  "eval_pairs",
  {
    id: uuid().primaryKey().defaultRandom(),
    reviewRecordId: uuid("review_record_id")
      .notNull()
      .references(() => reviewRecords.id, { onDelete: "cascade" }),
    beforeDiff: jsonb("before_diff").$type<DiffReference>().notNull(),
    afterDiff: jsonb("after_diff").$type<DiffReference>().notNull(),
    shuffleOrder: evalShuffleOrder("shuffle_order").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("eval_pairs_review_record_idx").on(table.reviewRecordId)],
);

export const evalVotes = pgTable(
  "eval_votes",
  {
    id: uuid().primaryKey().defaultRandom(),
    pairId: uuid("pair_id")
      .notNull()
      .references(() => evalPairs.id, { onDelete: "cascade" }),
    choice: evalVoteChoice().notNull(),
    voter: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("eval_votes_pair_voter_unique").on(table.pairId, table.voter),
    index("eval_votes_pair_idx").on(table.pairId),
  ],
);

function validCriterion(criteria: AnyPgColumn, key: keyof Review["criteria"]) {
  const criterion = jsonPath(key);
  const rating = jsonPath(key, "rating");
  const reasoning = jsonPath(key, "reasoning");

  return sql`
    coalesce(jsonb_typeof(${criteria} #> ${criterion}) = 'object', false)
    and case
      when jsonb_typeof(${criteria} #> ${rating}) = 'number'
      then (${criteria} #>> ${rating})::numeric between 0 and 5
        and (${criteria} #>> ${rating})::numeric = trunc((${criteria} #>> ${rating})::numeric)
      else false
    end
    and coalesce(jsonb_typeof(${criteria} #> ${reasoning}) = 'string', false)
  `;
}

function criterionRating(criteria: AnyPgColumn, key: keyof Review["criteria"]) {
  return sql`((${criteria} #>> ${jsonPath(key, "rating")})::smallint)`;
}

function jsonPath(key: keyof Review["criteria"], field?: "rating" | "reasoning") {
  return sql.raw(`'{${key}${field ? `,${field}` : ""}}'`);
}
