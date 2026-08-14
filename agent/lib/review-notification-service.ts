import { callSlackApi, type SlackBotToken } from "eve/channels/slack";

import { escapeMarkup } from "./escape-markup";
import type { NotificationClaim, ReviewRecord, ReviewRecordDao } from "./review-record-dao";
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

export type SlackNotificationApi = {
  findPosted(input: {
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

type DeliverPendingInput = {
  readonly channelId: string;
  readonly slack: SlackNotificationApi;
  readonly dao: ReviewRecordDao;
};

/**
 * Slack notification service (Web API hop, not a Slack agent turn).
 *
 * Slack and Postgres cannot commit together. We stamp `review_record_id` on
 * the Slack message. On `uncertain_retry` we look that id up before posting.
 */
export async function deliverPendingNotifications(input: DeliverPendingInput): Promise<number> {
  const claims = await input.dao.claimForDelivery();
  let delivered = 0;
  let failure: unknown;

  for (const claim of claims) {
    try {
      if (await deliverOne(claim, input)) delivered += 1;
    } catch (error) {
      failure ??= error;
    }
  }

  if (failure) throw failure;
  return delivered;
}

export function formatSlackNotification(record: ReviewRecord): string {
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

export function createSlackNotificationApi(
  botToken: SlackBotToken | undefined,
  request: SlackApiCall = callSlackApi,
): SlackNotificationApi {
  return {
    async findPosted({ attemptedAt, channelId, reviewRecordId }) {
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

async function deliverOne(claim: NotificationClaim, input: DeliverPendingInput): Promise<boolean> {
  const { record } = claim;
  const claimedAt = requiredDate(record.notificationClaimedAt, "claim");

  const alreadyOnSlack =
    claim.attempt === "uncertain_retry"
      ? await input.slack.findPosted({
          attemptedAt: requiredDate(record.notificationAttemptedAt, "first attempt"),
          channelId: input.channelId,
          reviewRecordId: record.id,
        })
      : null;

  const posted = alreadyOnSlack ?? (await postNew(claim, claimedAt, input));

  const marked = await input.dao.markDelivered(record.id, claimedAt, posted);
  if (!marked) throw new Error("Review notification claim expired before delivery was recorded.");
  return true;
}

async function postNew(
  claim: NotificationClaim,
  claimedAt: Date,
  input: DeliverPendingInput,
): Promise<PostedMessage> {
  const response = await input.slack.post({
    channelId: input.channelId,
    reviewRecordId: claim.record.id,
    text: formatSlackNotification(claim.record),
  });
  if (!response.ok) {
    await input.dao.releaseClaim(claim.record.id, claimedAt);
    throw new Error(`Slack chat.postMessage failed: ${String(response.error ?? "unknown error")}`);
  }

  const messageTs = typeof response.ts === "string" ? response.ts : null;
  if (!messageTs) throw new Error("Slack chat.postMessage returned no message timestamp.");
  return {
    channelId: typeof response.channel === "string" ? response.channel : input.channelId,
    messageTs,
  };
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

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function requiredDate(value: Date | null, name: string): Date {
  if (!value) throw new Error(`A claimed Review notification has no ${name} timestamp.`);
  return value;
}
