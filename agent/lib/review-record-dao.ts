import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Review } from "./review-helper";
import { reviewRecords } from "./review-record-schema";
import type { ReviewerInstructions } from "./reviewer-instructions";

type CreateReviewRecord = {
  readonly sourceTurnId: string;
  readonly repositoryId: number;
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly reviewedCommitSha: string;
  readonly instructions: Pick<ReviewerInstructions, "model" | "source" | "version">;
  readonly review: Review;
};

export type ReviewRecord = typeof reviewRecords.$inferSelect;

/**
 * A row we locked for Slack delivery.
 *
 * `attempt` is not a config flag. The DAO sets it from the row we just claimed:
 * - `first` — was `pending`. Slack should not have this message yet. Just post.
 * - `uncertain_retry` — was already `delivering` and the 5-minute lease expired.
 *   Slack may already have the message (post succeeded, DB never recorded it).
 *   The service must search Slack before posting again.
 */
export type NotificationClaim = {
  readonly record: ReviewRecord;
  readonly attempt: "first" | "uncertain_retry";
};

const notificationBatchSize = 20;
const notificationLeaseMs = 5 * 60 * 1_000;

export interface ReviewRecordDao {
  create(input: CreateReviewRecord): Promise<ReviewRecord>;
  listForPullRequest(repositoryId: number, pullRequestNumber: number): Promise<ReviewRecord[]>;
  claimForDelivery(): Promise<NotificationClaim[]>;
  markDelivered(
    id: string,
    claimedAt: Date,
    delivery: { readonly channelId: string; readonly messageTs: string },
  ): Promise<boolean>;
  releaseClaim(id: string, claimedAt: Date): Promise<void>;
  close(): Promise<void>;
}

export function createReviewRecordDao(
  databaseUrl: string = requiredDatabaseUrl(),
): ReviewRecordDao {
  const client = postgres(databaseUrl, {
    max: 4,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
  });
  const db = drizzle(client);

  return {
    async create(input) {
      // Same eve turn (sessionId:turnId) → same row if a crashed step re-runs.
      // Pre-select is outside the txn; unique index source_turn_id is the real guard.
      const existing = await db
        .select()
        .from(reviewRecords)
        .where(eq(reviewRecords.sourceTurnId, input.sourceTurnId))
        .limit(1);
      if (existing[0]) return existing[0];

      const id = randomUUID();
      const findings = input.review.findings.map((finding) => ({
        ...finding,
        id: randomUUID(),
      }));

      return db.transaction(async (tx) => {
        const current = await tx
          .select({ id: reviewRecords.id })
          .from(reviewRecords)
          .where(
            and(
              eq(reviewRecords.repositoryId, input.repositoryId),
              eq(reviewRecords.pullRequestNumber, input.pullRequestNumber),
              eq(reviewRecords.status, "active"),
            ),
          )
          .limit(1);

        const values = {
          id,
          sourceTurnId: input.sourceTurnId,
          repositoryId: input.repositoryId,
          repository: input.repository,
          pullRequestNumber: input.pullRequestNumber,
          reviewedCommitSha: input.reviewedCommitSha,
          model: input.instructions.model,
          instructionsVersion: input.instructions.version,
          instructionsSource: input.instructions.source,
          criteria: input.review.criteria,
          safetyRating: input.review.safetyRating,
          summary: input.review.summary,
          verdict: input.review.verdict,
          findings,
        } as const;

        if (!current[0]) {
          const inserted = await tx.insert(reviewRecords).values(values).returning();
          return requiredRecord(inserted);
        }

        // One active review per PR. Insert new as superseded first so the FK
        // and check (superseded must have supersededById) hold, then swap.
        await tx.insert(reviewRecords).values({
          ...values,
          status: "superseded",
          supersededById: current[0].id,
        });
        await tx
          .update(reviewRecords)
          .set({ status: "superseded", supersededById: id })
          .where(eq(reviewRecords.id, current[0].id));
        const activated = await tx
          .update(reviewRecords)
          .set({ status: "active", supersededById: null })
          .where(eq(reviewRecords.id, id))
          .returning();

        return requiredRecord(activated);
      });
    },

    listForPullRequest(repositoryId, pullRequestNumber) {
      return db
        .select()
        .from(reviewRecords)
        .where(
          and(
            eq(reviewRecords.repositoryId, repositoryId),
            eq(reviewRecords.pullRequestNumber, pullRequestNumber),
          ),
        )
        .orderBy(desc(reviewRecords.createdAt));
    },

    claimForDelivery() {
      const now = new Date();
      const leaseExpiredBefore = new Date(now.getTime() - notificationLeaseMs);

      return db.transaction(async (tx) => {
        const candidates = await tx
          .select()
          .from(reviewRecords)
          .where(
            or(
              eq(reviewRecords.notificationStatus, "pending"),
              and(
                eq(reviewRecords.notificationStatus, "delivering"),
                or(
                  isNull(reviewRecords.notificationClaimedAt),
                  lt(reviewRecords.notificationClaimedAt, leaseExpiredBefore),
                ),
              ),
            ),
          )
          .orderBy(reviewRecords.createdAt)
          .limit(notificationBatchSize)
          .for("update", { skipLocked: true });
        if (candidates.length === 0) return [];

        const firstIds = candidates
          .filter(({ notificationStatus }) => notificationStatus === "pending")
          .map(({ id }) => id);
        if (firstIds.length > 0) {
          await tx
            .update(reviewRecords)
            .set({
              notificationStatus: "delivering",
              notificationAttemptedAt: now,
              notificationClaimedAt: now,
            })
            .where(inArray(reviewRecords.id, firstIds));
        }

        const retryIds = candidates
          .filter(({ notificationStatus }) => notificationStatus === "delivering")
          .map(({ id }) => id);
        if (retryIds.length > 0) {
          await tx
            .update(reviewRecords)
            .set({ notificationClaimedAt: now })
            .where(inArray(reviewRecords.id, retryIds));
        }

        return candidates.map((row) => toClaim(row, now));
      });
    },

    async markDelivered(id, claimedAt, delivery) {
      const updated = await db
        .update(reviewRecords)
        .set({
          notificationStatus: "delivered",
          notificationDeliveredAt: new Date(),
          slackChannelId: delivery.channelId,
          slackMessageTs: delivery.messageTs,
        })
        .where(
          and(
            eq(reviewRecords.id, id),
            eq(reviewRecords.notificationStatus, "delivering"),
            eq(reviewRecords.notificationClaimedAt, claimedAt),
          ),
        )
        .returning({ id: reviewRecords.id });
      return updated.length === 1;
    },

    async releaseClaim(id, claimedAt) {
      await db
        .update(reviewRecords)
        .set({
          notificationStatus: "pending",
          notificationAttemptedAt: null,
          notificationClaimedAt: null,
        })
        .where(
          and(
            eq(reviewRecords.id, id),
            eq(reviewRecords.notificationStatus, "delivering"),
            eq(reviewRecords.notificationClaimedAt, claimedAt),
          ),
        );
    },

    close: () => client.end(),
  };
}

let sharedDao: ReviewRecordDao | undefined;

export function getReviewRecordDao(): ReviewRecordDao {
  sharedDao ??= createReviewRecordDao();
  return sharedDao;
}

/** pending → first. Already delivering (lease expired) → uncertain_retry. */
function toClaim(row: ReviewRecord, now: Date): NotificationClaim {
  const attempt = row.notificationStatus === "delivering" ? "uncertain_retry" : "first";
  return {
    attempt,
    record: {
      ...row,
      notificationStatus: "delivering",
      notificationAttemptedAt: row.notificationAttemptedAt ?? now,
      notificationClaimedAt: now,
    },
  };
}

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required to persist ReviewRecords.");
  return value;
}

function requiredRecord(records: readonly ReviewRecord[]): ReviewRecord {
  const record = records[0];
  if (!record) throw new Error("ReviewRecord write returned no row.");
  return record;
}
