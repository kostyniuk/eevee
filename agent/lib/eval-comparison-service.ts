import { randomInt } from "node:crypto";

import type { GitHubHandle } from "eve/channels/github";
import { callSlackApi, type SlackBotToken } from "eve/channels/slack";

import type {
  EvalPair,
  GitHubReactionFeedback,
  ReviewRecord,
  ReviewRecordDao,
} from "./review-record-dao";

const evalPairEventType = "eval_comparison";
const formalReviewMarker = "<!-- evee:formal-review -->";

type GitHubRequest = GitHubHandle["request"];

export type EvalSlackResponse = {
  readonly ok: boolean;
  readonly channel?: unknown;
  readonly error?: unknown;
  readonly messages?: unknown;
  readonly response_metadata?: { readonly next_cursor?: unknown };
  readonly ts?: unknown;
};

export type EvalSlackApiCall = (input: {
  readonly botToken: SlackBotToken | undefined;
  readonly operation: string;
  readonly body: unknown;
}) => Promise<EvalSlackResponse>;

export type EvalComparisonSlackApi = ReturnType<typeof createEvalComparisonSlackApi>;

export async function processClosedPullRequest(input: {
  readonly repositoryId: number;
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly finalHeadSha: string | null;
  readonly merged: boolean;
  readonly evalChannelId: string;
  readonly github: { request: GitHubRequest };
  readonly slack: EvalComparisonSlackApi;
  readonly dao: ReviewRecordDao;
}): Promise<void> {
  const claim = await input.dao.claimCloseProcessing(input.repositoryId, input.pullRequestNumber);
  if (!claim) return;

  try {
    const surface = await findPublishedReview(
      input.github.request,
      input.repository,
      input.pullRequestNumber,
      claim.record,
    );
    if (surface) {
      const reactions = await harvestReactions(input.github.request, claim.record, surface);
      await input.dao.addGitHubReactionFeedback(claim.record.id, reactions);
    }

    if (
      input.merged &&
      claim.record.baseCommitSha &&
      input.finalHeadSha &&
      input.finalHeadSha !== claim.record.reviewedCommitSha
    ) {
      const pair = await input.dao.createEvalPair({
        reviewRecordId: claim.record.id,
        beforeDiff: {
          repository: input.repository,
          baseSha: claim.record.baseCommitSha,
          headSha: claim.record.reviewedCommitSha,
        },
        afterDiff: {
          repository: input.repository,
          baseSha: claim.record.baseCommitSha,
          headSha: input.finalHeadSha,
        },
        shuffleOrder: randomInt(2) === 0 ? "before_first" : "after_first",
      });
      await deliverEvalPair({
        pair,
        channelId: input.evalChannelId,
        github: input.github.request,
        slack: input.slack,
        dao: input.dao,
      });
    }

    const completed = await input.dao.completeCloseProcessing(claim.record.id, claim.claimedAt);
    if (!completed) throw new Error("PR-close processing claim expired before completion.");
  } catch (error) {
    await input.dao.releaseCloseProcessing(claim.record.id, claim.claimedAt);
    throw error;
  }
}

export function createEvalComparisonSlackApi(
  botToken: SlackBotToken | undefined,
  request: EvalSlackApiCall = callSlackApi,
) {
  return {
    async findPosted(input: {
      readonly attemptedAt: Date;
      readonly channelId: string;
      readonly pairId: string;
    }) {
      let cursor: string | undefined;
      do {
        const response = await request({
          botToken,
          operation: "conversations.history",
          body: {
            channel: input.channelId,
            cursor,
            include_all_metadata: true,
            inclusive: true,
            limit: 200,
            oldest: String(Math.max(0, input.attemptedAt.getTime() / 1_000 - 60)),
          },
        });
        assertSlackOk(response, "conversations.history");
        const found = findPairMessage(response.messages, input.pairId);
        if (found) return { channelId: input.channelId, messageTs: found };
        const next = response.response_metadata?.next_cursor;
        cursor = typeof next === "string" && next.length > 0 ? next : undefined;
      } while (cursor);
      return null;
    },

    post(input: {
      readonly channelId: string;
      readonly pairId: string;
      readonly blocks: readonly unknown[];
      readonly text: string;
    }) {
      return request({
        botToken,
        operation: "chat.postMessage",
        body: {
          channel: input.channelId,
          blocks: input.blocks,
          metadata: {
            event_type: evalPairEventType,
            event_payload: { eval_pair_id: input.pairId },
          },
          text: input.text,
          unfurl_links: false,
          unfurl_media: false,
        },
      });
    },
  };
}

export async function recordEvalVote(input: {
  readonly actionId: string;
  readonly pairId: string;
  readonly voter: string;
  readonly dao: ReviewRecordDao;
  readonly reveal: (message: string) => Promise<unknown>;
}): Promise<"ignored" | "recorded" | "already_recorded"> {
  const displayedChoice =
    input.actionId === "eval_vote_a" ? "a" : input.actionId === "eval_vote_b" ? "b" : null;
  if (!displayedChoice) return "ignored";

  const pair = await input.dao.getEvalPair(input.pairId);
  if (!pair) return "ignored";

  const vote = await input.dao.recordEvalVote({
    pairId: input.pairId,
    choice: displayedToIdentity(displayedChoice, pair),
    voter: input.voter,
  });
  if (!vote) return "ignored";
  if (!vote.created) return "already_recorded";

  const beforeSide = vote.pair.shuffleOrder === "before_first" ? "A" : "B";
  const afterSide = beforeSide === "A" ? "B" : "A";
  await input.reveal(
    `Vote recorded for side ${displayedChoice.toUpperCase()}. Identity reveal: side ${beforeSide} is the code as reviewed; side ${afterSide} is the code as merged.`,
  );
  return "recorded";
}

function displayedToIdentity(choice: "a" | "b", pair: EvalPair): "before" | "after" {
  const aIsBefore = pair.shuffleOrder === "before_first";
  return choice === "a" ? (aIsBefore ? "before" : "after") : aIsBefore ? "after" : "before";
}

async function deliverEvalPair(input: {
  readonly pair: EvalPair;
  readonly channelId: string;
  readonly github: GitHubRequest;
  readonly slack: EvalComparisonSlackApi;
  readonly dao: ReviewRecordDao;
}) {
  const claim = await input.dao.claimEvalPairDelivery(input.pair.id);
  if (!claim) {
    const current = await input.dao.getEvalPair(input.pair.id);
    if (current?.deliveryStatus === "delivered") return;
    throw new Error("Eval pair is still held by another delivery claim.");
  }
  const claimedAt = requiredDate(claim.pair.deliveryClaimedAt, "delivery claim");

  const alreadyPosted =
    claim.attempt === "uncertain_retry"
      ? await input.slack.findPosted({
          attemptedAt: requiredDate(claim.pair.deliveryAttemptedAt, "delivery attempt"),
          channelId: input.channelId,
          pairId: claim.pair.id,
        })
      : null;

  let posted = alreadyPosted;
  if (!posted) {
    const [before, after] = await Promise.all([
      renderDiff(input.github, claim.pair.beforeDiff),
      renderDiff(input.github, claim.pair.afterDiff),
    ]);
    const blocks = formatEvalPairBlocks(claim.pair, before, after);
    const response = await input.slack.post({
      channelId: input.channelId,
      pairId: claim.pair.id,
      blocks,
      text: "Blind PR code comparison — choose the stronger side.",
    });
    if (!response.ok) {
      await input.dao.releaseEvalPairDelivery(claim.pair.id, claimedAt);
      throw new Error(
        `Slack chat.postMessage failed: ${String(response.error ?? "unknown error")}`,
      );
    }
    const messageTs = typeof response.ts === "string" ? response.ts : null;
    if (!messageTs) throw new Error("Slack chat.postMessage returned no message timestamp.");
    posted = {
      channelId: typeof response.channel === "string" ? response.channel : input.channelId,
      messageTs,
    };
  }

  const marked = await input.dao.markEvalPairDelivered(claim.pair.id, claimedAt, posted);
  if (!marked) throw new Error("Eval-pair delivery claim expired before delivery was recorded.");
}

function formatEvalPairBlocks(pair: EvalPair, before: string, after: string): readonly unknown[] {
  const sideA = pair.shuffleOrder === "before_first" ? before : after;
  const sideB = pair.shuffleOrder === "before_first" ? after : before;
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Blind PR code comparison*\nWhich version is stronger? Identities stay hidden until you vote.",
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Side A*\n\`\`\`${safeFence(sideA)}\`\`\`` },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Side B*\n\`\`\`${safeFence(sideB)}\`\`\`` },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: "eval_vote_a",
          text: { type: "plain_text", text: "A is better" },
          value: pair.id,
        },
        {
          type: "button",
          action_id: "eval_vote_b",
          text: { type: "plain_text", text: "B is better" },
          value: pair.id,
        },
      ],
    },
  ];
}

async function renderDiff(request: GitHubRequest, ref: EvalPair["beforeDiff"]): Promise<string> {
  const [owner, repo] = splitRepository(ref.repository);
  const response = await request<{ readonly files?: readonly unknown[] }>({
    method: "GET",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${ref.baseSha}...${ref.headSha}`,
  });
  const files = Array.isArray(response.body?.files) ? response.body.files : [];
  const rendered = files.flatMap((file) => {
    if (!isObject(file) || typeof file.filename !== "string") return [];
    const patch = typeof file.patch === "string" ? file.patch : "(binary or patch unavailable)";
    return [`--- ${file.filename}\n${patch}`];
  });
  return truncate(rendered.join("\n\n") || "(no textual diff)", 2_400);
}

type PublishedReview = {
  readonly reviewNodeId: string;
  readonly comments: readonly { readonly nodeId: string; readonly body: string }[];
};

async function findPublishedReview(
  request: GitHubRequest,
  repository: string,
  pullRequestNumber: number,
  record: ReviewRecord,
): Promise<PublishedReview | null> {
  const [owner, repo] = splitRepository(repository);
  const root = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullRequestNumber}`;
  const reviews = await listGitHubPages(request, `${root}/reviews`);
  const published = [...reviews].reverse().find((value) => {
    if (!isObject(value)) return false;
    return (
      value.commit_id === record.reviewedCommitSha &&
      typeof value.body === "string" &&
      value.body.includes(formalReviewMarker)
    );
  });
  if (
    !isObject(published) ||
    typeof published.id !== "number" ||
    typeof published.node_id !== "string"
  ) {
    return null;
  }

  const comments = (
    await listGitHubPages(request, `${root}/reviews/${published.id}/comments`)
  ).flatMap((value) =>
    isObject(value) && typeof value.node_id === "string" && typeof value.body === "string"
      ? [{ nodeId: value.node_id, body: value.body }]
      : [],
  );
  return { reviewNodeId: published.node_id, comments };
}

async function listGitHubPages(request: GitHubRequest, path: string): Promise<unknown[]> {
  const values: unknown[] = [];
  for (let page = 1; ; page += 1) {
    const response = await request<unknown>({
      method: "GET",
      path: `${path}?per_page=100&page=${page}`,
    });
    if (!Array.isArray(response.body)) {
      throw new Error(`GitHub ${path} returned a non-list response.`);
    }
    values.push(...response.body);
    if (response.body.length < 100) return values;
  }
}

async function harvestReactions(
  request: GitHubRequest,
  record: ReviewRecord,
  surface: PublishedReview,
): Promise<GitHubReactionFeedback[]> {
  const subjects = [
    { nodeId: surface.reviewNodeId, findingId: null },
    ...surface.comments.map((comment, index) => ({
      nodeId: comment.nodeId,
      findingId: matchFinding(record, comment.body, index),
    })),
  ];
  const batches = await Promise.all(
    subjects.map(async (subject) => {
      const reactions = await listThumbReactions(request, subject.nodeId);
      return reactions.map((reaction) => ({ ...reaction, findingId: subject.findingId }));
    }),
  );
  return batches.flat();
}

async function listThumbReactions(
  request: GitHubRequest,
  nodeId: string,
): Promise<Omit<GitHubReactionFeedback, "findingId">[]> {
  const found: Omit<GitHubReactionFeedback, "findingId">[] = [];
  let cursor: string | null = null;
  do {
    const response = await request<unknown>({
      method: "POST",
      path: "/graphql",
      body: {
        query: `query Reactions($id: ID!, $cursor: String) { node(id: $id) { ... on Reactable { reactions(first: 100, after: $cursor) { nodes { id content createdAt user { login } } pageInfo { hasNextPage endCursor } } } } }`,
        variables: { id: nodeId, cursor },
      },
    });
    const reactions = reactionConnection(response.body);
    for (const value of reactions.nodes) {
      if (
        !isObject(value) ||
        typeof value.id !== "string" ||
        !isObject(value.user) ||
        typeof value.user.login !== "string"
      )
        continue;
      const mapped =
        value.content === "THUMBS_UP" ? "up" : value.content === "THUMBS_DOWN" ? "down" : null;
      if (!mapped) continue;
      found.push({
        externalId: `github-reaction:${value.id}`,
        author: value.user.login,
        value: mapped,
        createdAt: typeof value.createdAt === "string" ? new Date(value.createdAt) : new Date(),
      });
    }
    cursor = reactions.hasNextPage ? reactions.endCursor : null;
  } while (cursor);
  return found;
}

function reactionConnection(value: unknown): {
  readonly nodes: readonly unknown[];
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
} {
  if (isObject(value) && Array.isArray(value.errors) && value.errors.length > 0) {
    throw new Error("GitHub GraphQL returned errors while harvesting reactions.");
  }
  if (
    !isObject(value) ||
    !isObject(value.data) ||
    !isObject(value.data.node) ||
    !isObject(value.data.node.reactions)
  ) {
    return { nodes: [], hasNextPage: false, endCursor: null };
  }
  const connection = value.data.node.reactions;
  const pageInfo = isObject(connection.pageInfo) ? connection.pageInfo : {};
  return {
    nodes: Array.isArray(connection.nodes) ? connection.nodes : [],
    hasNextPage: pageInfo.hasNextPage === true,
    endCursor: typeof pageInfo.endCursor === "string" ? pageInfo.endCursor : null,
  };
}

function matchFinding(
  record: ReviewRecord,
  commentBody: string,
  fallbackIndex: number,
): string | null {
  const exact = record.findings.find(
    (finding) => `**${finding.title}**\n\n${finding.body}` === commentBody,
  );
  return exact?.id ?? record.findings[fallbackIndex]?.id ?? null;
}

function findPairMessage(messages: unknown, pairId: string): string | null {
  if (!Array.isArray(messages)) return null;
  for (const value of messages) {
    if (!isObject(value) || !isObject(value.metadata) || !isObject(value.metadata.event_payload))
      continue;
    if (
      value.metadata.event_type === evalPairEventType &&
      value.metadata.event_payload.eval_pair_id === pairId &&
      typeof value.ts === "string"
    )
      return value.ts;
  }
  return null;
}

function splitRepository(repository: string): readonly [string, string] {
  const [owner, repo, ...rest] = repository.split("/");
  if (!owner || !repo || rest.length > 0)
    throw new Error(`Invalid GitHub repository: ${repository}`);
  return [owner, repo];
}

function safeFence(value: string): string {
  return value.replaceAll("```", "`\u200b``");
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 16)}\n… [truncated]`;
}

function assertSlackOk(response: EvalSlackResponse, operation: string): void {
  if (!response.ok)
    throw new Error(`Slack ${operation} failed: ${String(response.error ?? "unknown error")}`);
}

function requiredDate(value: Date | null, label: string): Date {
  if (!value) throw new Error(`Eval pair has no ${label} timestamp.`);
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
