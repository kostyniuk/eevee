import { callSlackApi, type SlackBotToken } from "eve/channels/slack";

import { escapeMarkup } from "./escape-markup";
import type {
  ReviewNotificationClaim,
  ReviewRecord,
  ReviewRecordStore,
} from "./review-record-store";
import { reviewerInstructions } from "./reviewer-instructions";

const notificationEventType = "review_notification";

export type SlackResponse = {
  readonly ok: boolean;
  readonly channel?: unknown;
  readonly error?: unknown;
  readonly messages?: unknown;
  readonly response_metadata?: { readonly next_cursor?: unknown };
  readonly ts?: unknown;
};

export type SlackApiCall = (input: {
  readonly botToken: SlackBotToken | undefined;
  readonly operation: string;
  readonly body: unknown;
}) => Promise<SlackResponse>;

export type ReviewNotificationClient = {
  find(input: {
    readonly attemptedAt: Date;
    readonly channelId: string;
    readonly reviewRecordId: string;
  }): Promise<PostedMessage | null>;
  post(input: {
    readonly channelId: string;
    readonly reviewRecordId: string;
    readonly text: string;
  }): Promise<SlackResponse>;
};

type PostedMessage = {
  readonly channelId: string;
  readonly messageTs: string;
};

type Delivery = {
  readonly channelId: string;
  readonly client: ReviewNotificationClient;
  readonly store: ReviewRecordStore;
};

// Slack and Postgres cannot commit together. Message metadata lets a retry find
// a post that succeeded before the process lost its database acknowledgment.
export function createSlackReviewNotificationClient(
  botToken: SlackBotToken | undefined,
  request: SlackApiCall = callSlackApi,
): ReviewNotificationClient {
  return {
    async find({ attemptedAt, channelId, reviewRecordId }) {
      let cursor: string | undefined;

      do {
        const response = await request({
          botToken,
          operation: "conversations.history",
          body: {
            channel: channelId,
            cursor,
            include_all_metadata: true,
            inclusive: true,
            limit: 200,
            oldest: String(Math.max(0, attemptedAt.getTime() / 1_000 - 60)),
          },
        });
        if (!response.ok) {
          throw new Error(
            `Slack conversations.history failed: ${String(response.error ?? "unknown error")}`,
          );
        }

        const messageTs = findMessageTs(response.messages, reviewRecordId);
        if (messageTs) return { channelId, messageTs };

        const nextCursor = response.response_metadata?.next_cursor;
        cursor = typeof nextCursor === "string" && nextCursor.length > 0 ? nextCursor : undefined;
      } while (cursor);

      return null;
    },

    post({ channelId, reviewRecordId, text }) {
      return request({
        botToken,
        operation: "chat.postMessage",
        body: {
          channel: channelId,
          metadata: {
            event_type: notificationEventType,
            event_payload: { review_record_id: reviewRecordId },
          },
          text,
          unfurl_links: false,
          unfurl_media: false,
        },
      });
    },
  };
}

export async function deliverPendingReviewNotifications(options: Delivery): Promise<number> {
  const claims = await options.store.claimPendingNotifications();
  let delivered = 0;
  let failure: unknown;

  for (const claim of claims) {
    try {
      if (await deliverReviewNotification(claim, options)) delivered += 1;
    } catch (error) {
      failure ??= error;
    }
  }

  if (failure) throw failure;
  return delivered;
}

export function formatReviewNotification(record: ReviewRecord): string {
  const pullRequestUrl = `https://github.com/${record.repository}/pull/${record.pullRequestNumber}`;
  const reference = `${record.repository}#${record.pullRequestNumber}`;
  const summary = collapseWhitespace(record.summary);
  const verdict = collapseWhitespace(record.verdict);
  const lines = [
    `:shield: *Safety Rating: ${record.safetyRating}/5* · <${pullRequestUrl}|${escapeMarkup(reference)}>`,
    "",
    `:memo: *Summary:* ${escapeMarkup(summary)}`,
    "",
    `:scales: *Verdict:* ${escapeMarkup(verdict)}`,
  ];

  const topFinding =
    record.safetyRating < reviewerInstructions.findingThreshold ? record.findings[0] : undefined;
  if (topFinding) {
    lines.push(
      "",
      `:pushpin: *Top finding — ${escapeMarkup(topFinding.title)}*`,
      escapeMarkup(topFinding.body),
    );
  }

  return lines.join("\n");
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

async function deliverReviewNotification(
  claim: ReviewNotificationClaim,
  options: Delivery,
): Promise<boolean> {
  const { record } = claim;
  const claimedAt = requiredDate(record.notificationClaimedAt, "claim");
  let posted = claim.retry
    ? await options.client.find({
        attemptedAt: requiredDate(record.notificationAttemptedAt, "first attempt"),
        channelId: options.channelId,
        reviewRecordId: record.id,
      })
    : null;

  if (!posted) {
    const response = await options.client.post({
      channelId: options.channelId,
      reviewRecordId: record.id,
      text: formatReviewNotification(record),
    });
    if (!response.ok) {
      await options.store.releaseNotification(record.id, claimedAt);
      throw new Error(
        `Slack chat.postMessage failed: ${String(response.error ?? "unknown error")}`,
      );
    }

    const messageTs = typeof response.ts === "string" ? response.ts : null;
    if (!messageTs) throw new Error("Slack chat.postMessage returned no message timestamp.");
    posted = {
      channelId: typeof response.channel === "string" ? response.channel : options.channelId,
      messageTs,
    };
  }

  const marked = await options.store.markNotificationDelivered(record.id, claimedAt, posted);
  if (!marked) throw new Error("Review notification claim expired before delivery was recorded.");
  return true;
}

function findMessageTs(messages: unknown, reviewRecordId: string): string | null {
  if (!Array.isArray(messages)) return null;

  for (const value of messages) {
    if (typeof value !== "object" || value === null) continue;
    const message = value as {
      readonly metadata?: {
        readonly event_payload?: { readonly review_record_id?: unknown };
        readonly event_type?: unknown;
      };
      readonly ts?: unknown;
    };
    if (
      message.metadata?.event_type === notificationEventType &&
      message.metadata.event_payload?.review_record_id === reviewRecordId &&
      typeof message.ts === "string"
    ) {
      return message.ts;
    }
  }

  return null;
}

function requiredDate(value: Date | null, name: string): Date {
  if (!value) throw new Error(`A claimed Review notification has no ${name} timestamp.`);
  return value;
}
