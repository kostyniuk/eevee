import { defineEval } from "eve/evals";
import { equals, includes, satisfies } from "eve/evals/expect";

import {
  createSlackReviewNotificationClient,
  deliverPendingReviewNotifications,
  formatReviewNotification,
} from "#lib/review-notification-delivery";
import type { ReviewRecord, ReviewRecordStore } from "#lib/review-record-store";

const record: ReviewRecord = {
  id: "18fce0f7-9c2b-4542-8bb8-93a8a849e24a",
  sourceTurnId: "fixture:ambiguous-send",
  repositoryId: 91_337,
  repository: "kostyniuk/fixture",
  pullRequestNumber: 42,
  reviewedCommitSha: "a".repeat(40),
  model: "fixture-model",
  instructionsVersion: "b".repeat(64),
  instructionsSource: "model",
  criteria: {
    security: { rating: 4, reasoning: "Safe." },
    blastRadius: { rating: 4, reasoning: "Narrow." },
    correctness: { rating: 4, reasoning: "Correct." },
    dataSafety: { rating: 4, reasoning: "Safe." },
    testCoverage: { rating: 4, reasoning: "Covered." },
    readability: { rating: 4, reasoning: "Clear." },
  },
  safetyRating: 4,
  summary: "Narrow fixture change for notification delivery tests.",
  verdict: "Safe to review.",
  findings: [],
  status: "active",
  supersededById: null,
  notificationStatus: "delivering",
  notificationAttemptedAt: new Date("2026-08-13T10:00:00Z"),
  notificationClaimedAt: new Date("2026-08-13T10:00:00Z"),
  notificationDeliveredAt: null,
  slackChannelId: null,
  slackMessageTs: null,
  createdAt: new Date("2026-08-13T10:00:00Z"),
};

export default defineEval({
  description: "A retry after a Slack success and DB failure does not post twice.",
  async test(t) {
    let delivered = false;
    let failMark = true;
    let claims = 0;
    let historyReads = 0;
    let posts = 0;
    const messages: Array<Record<string, unknown>> = [];
    const store: ReviewRecordStore = {
      create: async () => record,
      listForPullRequest: async () => [],
      claimPendingNotifications: async () => {
        if (delivered) return [];
        const retry = claims > 0;
        claims += 1;
        return [{ record, retry }];
      },
      async markNotificationDelivered() {
        if (failMark) {
          failMark = false;
          throw new Error("Injected database acknowledgment failure.");
        }
        delivered = true;
        return true;
      },
      releaseNotification: async () => {},
      close: async () => {},
    };
    const client = createSlackReviewNotificationClient(
      "fixture-token",
      async ({ operation, body }) => {
        const input = body as Record<string, unknown>;
        if (operation === "conversations.history") {
          historyReads += 1;
          return { ok: true, messages, response_metadata: { next_cursor: "" } };
        }

        posts += 1;
        messages.push({ metadata: input.metadata, ts: "1712345678.000100" });
        return { ok: true, channel: input.channel, ts: "1712345678.000100" };
      },
    );

    await deliverPendingReviewNotifications({
      channelId: "C_REVIEW_FIXTURE",
      client,
      store,
    }).catch(() => {});
    await deliverPendingReviewNotifications({ channelId: "C_REVIEW_FIXTURE", client, store });

    t.check(posts, equals(1));
    t.check(historyReads, equals(1));

    const staleStore: ReviewRecordStore = {
      ...store,
      claimPendingNotifications: async () => [{ record, retry: true }],
      async markNotificationDelivered() {
        return false;
      },
    };
    let staleError = "";
    try {
      await deliverPendingReviewNotifications({
        channelId: "C_REVIEW_FIXTURE",
        client,
        store: staleStore,
      });
    } catch (error) {
      staleError = error instanceof Error ? error.message : String(error);
    }
    t.check(staleError, includes("claim expired"));

    t.check(
      formatReviewNotification({
        ...record,
        safetyRating: 3,
        findings: [
          {
            id: "e6ac22bb-e07d-43ea-bccf-a7f77cc2644c",
            path: "agent/example.ts",
            line: 12,
            side: "RIGHT",
            title: "Do not show this",
            body: "A rating at the threshold has no top Finding.",
          },
        ],
      }),
      satisfies(
        (text) => typeof text === "string" && !text.includes("Top finding"),
        "no Finding at the threshold",
      ),
    );
  },
});
