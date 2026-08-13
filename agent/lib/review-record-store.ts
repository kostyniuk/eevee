import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";
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

type ReviewRecord = typeof reviewRecords.$inferSelect;

interface ReviewRecordStore {
  create(input: CreateReviewRecord): Promise<ReviewRecord>;
  listForPullRequest(repositoryId: number, pullRequestNumber: number): Promise<ReviewRecord[]>;
  close(): Promise<void>;
}

export function createReviewRecordStore(
  databaseUrl: string = requiredDatabaseUrl(),
): ReviewRecordStore {
  const client = postgres(databaseUrl, {
    max: 4,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
  });
  const db = drizzle(client);

  return {
    async create(input) {
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
          verdict: input.review.verdict,
          findings,
        } as const;

        if (!current[0]) {
          const inserted = await tx.insert(reviewRecords).values(values).returning();
          return requiredRecord(inserted);
        }

        // The old row cannot point at the replacement until its foreign key exists.
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

    close: () => client.end(),
  };
}

let sharedStore: ReviewRecordStore | undefined;

export function getReviewRecordStore(): ReviewRecordStore {
  sharedStore ??= createReviewRecordStore();
  return sharedStore;
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
