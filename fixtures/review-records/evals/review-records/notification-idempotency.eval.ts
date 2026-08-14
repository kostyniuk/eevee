import { defineEval } from "eve/evals";
import { equals, includes, satisfies } from "eve/evals/expect";

import {
  createSlackNotificationApi,
  deliverPendingNotifications,
  formatSlackNotification,
} from "#lib/review-notification-service";
import type { ReviewRecord, ReviewRecordDao } from "#lib/review-record-dao";
import { reviewerInstructions } from "#lib/reviewer-instructions";

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
    const dao: ReviewRecordDao = {
      create: async () => record,
      listForPullRequest: async () => [],
      claimForDelivery: async () => {
        if (delivered) return [];
        const attempt = claims === 0 ? "first" : "uncertain_retry";
        claims += 1;
        return [{ record, attempt }];
      },
      async markDelivered() {
        if (failMark) {
          failMark = false;
          throw new Error("Injected database acknowledgment failure.");
        }
        delivered = true;
        return true;
      },
      releaseClaim: async () => {},
      close: async () => {},
    };
    const slack = createSlackNotificationApi("fixture-token", async ({ operation, body }) => {
      const input = body as Record<string, unknown>;
      if (operation === "conversations.history") {
        historyReads += 1;
        return { ok: true, messages, response_metadata: { next_cursor: "" } };
      }

      posts += 1;
      messages.push({ metadata: input.metadata, ts: "1712345678.000100" });
      return { ok: true, channel: input.channel, ts: "1712345678.000100" };
    });

    await deliverPendingNotifications({
      channelId: "C_REVIEW_FIXTURE",
      slack,
      dao,
    }).catch(() => {});
    await deliverPendingNotifications({ channelId: "C_REVIEW_FIXTURE", slack, dao });

    t.check(posts, equals(1));
    t.check(historyReads, equals(1));

    const staleDao: ReviewRecordDao = {
      ...dao,
      claimForDelivery: async () => [{ record, attempt: "uncertain_retry" }],
      async markDelivered() {
        return false;
      },
    };
    let staleError = "";
    try {
      await deliverPendingNotifications({
        channelId: "C_REVIEW_FIXTURE",
        slack,
        dao: staleDao,
      });
    } catch (error) {
      staleError = error instanceof Error ? error.message : String(error);
    }
    t.check(staleError, includes("claim expired"));

    t.check(
      formatSlackNotification({
        ...record,
        safetyRating: reviewerInstructions.findingThreshold,
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
