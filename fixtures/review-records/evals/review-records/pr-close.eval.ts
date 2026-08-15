import { createHmac, randomBytes, randomInt } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";

import { defineEval, type EveEvalContext } from "eve/evals";
import { equals, includes, satisfies } from "eve/evals/expect";

import { recordEvalVote } from "#lib/eval-comparison-service";
import { createReviewRecordDao } from "#lib/review-record-dao";
import { reviewerInstructions } from "#lib/reviewer-instructions";
import { githubFixture } from "../../agent/channels/github";

const repositoryId = 91_337;
const pullRequestNumber = randomInt(10_000, 1_000_000);
const baseSha = "3".repeat(40);
const reviewedSha = "4".repeat(40);
const mergedSha = randomBytes(20).toString("hex");

export default defineEval({
  description: "Closing a reviewed PR harvests reactions and posts one blind eval pair.",
  async test(t) {
    const github = await startGitHubApiStub();
    const slack = await startSlackApiStub();
    const dao = createReviewRecordDao();

    try {
      const record = await dao.create({
        sourceTurnId: `close-eval:${randomBytes(12).toString("hex")}`,
        repositoryId,
        repository: "kostyniuk/fixture",
        pullRequestNumber,
        baseCommitSha: baseSha,
        reviewedCommitSha: reviewedSha,
        instructions: reviewerInstructions,
        review: {
          safetyRating: 2,
          summary: "A reviewed implementation.",
          verdict: "One correctness issue needs attention.",
          criteria: {
            security: { rating: 4, reasoning: "Safe." },
            blastRadius: { rating: 3, reasoning: "Contained." },
            correctness: { rating: 2, reasoning: "Edge case." },
            dataSafety: { rating: 4, reasoning: "No persistence risk." },
            testCoverage: { rating: 3, reasoning: "Some coverage." },
            readability: { rating: 4, reasoning: "Clear." },
          },
          findings: [
            {
              path: "agent/example.ts",
              line: 12,
              side: "RIGHT",
              title: "Handle the empty input",
              body: "The empty-input path returns the wrong value.",
            },
          ],
        },
      });

      const first = await sendClosedWebhook(t, pullRequestNumber, mergedSha);
      const duplicate = await sendClosedWebhook(t, pullRequestNumber, mergedSha);
      t.check(first.status, equals(200));
      t.check(duplicate.status, equals(200));

      await waitForClose(t, dao, pullRequestNumber, record.id);
      const feedback = await dao.listFeedback(record.id);
      t.check(feedback.length, equals(2));
      t.check(
        feedback
          .map(({ value }) => value)
          .sort()
          .join(","),
        equals("down,up"),
      );
      t.check(
        feedback.find(
          ({ externalId }) => externalId === `github-reaction:R_FINDING_${pullRequestNumber}`,
        )?.findingId,
        equals(record.findings[0]?.id),
      );

      const pairs = await dao.listEvalPairs(record.id);
      t.check(pairs.length, equals(1));
      const pair = pairs[0]!;
      t.check(pair.beforeDiff.headSha, equals(reviewedSha));
      t.check(pair.afterDiff.headSha, equals(mergedSha));
      t.check(pair.deliveryStatus, equals("delivered"));
      t.check(github.graphqlCalls(), equals(2));

      const message = slack.evalMessages()[0];
      t.check(slack.evalMessages().length, equals(1));
      t.check(message?.channel, equals("C_EVAL_FIXTURE"));
      t.check(message?.metadata, includes(`"eval_pair_id":"${pair.id}"`));
      t.check(message?.blocks, includes("Side A"));
      t.check(message?.blocks, includes("Side B"));
      t.check(
        message?.blocks,
        satisfies(
          (blocks) =>
            typeof blocks === "string" &&
            !blocks.includes("code as reviewed") &&
            !blocks.includes("code as merged"),
          "pair stays blind",
        ),
      );

      const reveals: string[] = [];
      const result = await recordEvalVote({
        actionId: "eval_vote_a",
        pairId: pair.id,
        voter: "U_JUDGE",
        dao,
        reveal: async (message) => {
          reveals.push(message);
        },
      });
      const duplicateVote = await recordEvalVote({
        actionId: "eval_vote_b",
        pairId: pair.id,
        voter: "U_JUDGE",
        dao,
        reveal: async (message) => {
          reveals.push(message);
        },
      });
      t.check(result, equals("recorded"));
      t.check(duplicateVote, equals("already_recorded"));
      t.check(reveals.length, equals(1));
      t.check(reveals[0], includes("Identity reveal"));

      const votes = await dao.listEvalVotes(pair.id);
      t.check(votes.length, equals(1));
      t.check(votes[0]?.voter, equals("U_JUDGE"));
      t.check(votes[0]?.choice, equals(pair.shuffleOrder === "before_first" ? "before" : "after"));

      const unchangedNumber = pullRequestNumber + 1;
      const unchanged = await dao.create({
        sourceTurnId: `unchanged-eval:${randomBytes(12).toString("hex")}`,
        repositoryId,
        repository: "kostyniuk/fixture",
        pullRequestNumber: unchangedNumber,
        baseCommitSha: baseSha,
        reviewedCommitSha: mergedSha,
        instructions: reviewerInstructions,
        review: {
          safetyRating: 5,
          summary: "Already final.",
          verdict: "No post-review changes.",
          criteria: record.criteria,
          findings: [],
        },
      });
      const unchangedResponse = await sendClosedWebhook(t, unchangedNumber, mergedSha);
      t.check(unchangedResponse.status, equals(200));
      await waitForClose(t, dao, unchangedNumber, unchanged.id);
      t.check((await dao.listEvalPairs(unchanged.id)).length, equals(0));
      t.check(slack.evalMessages().length, equals(1));
    } finally {
      await dao.close();
      await slack.close();
      await github.close();
    }
  },
});

function sendClosedWebhook(t: EveEvalContext, number: number, headSha: string) {
  const body = JSON.stringify({
    action: "closed",
    installation: { id: 123 },
    repository: {
      id: repositoryId,
      name: "fixture",
      full_name: "kostyniuk/fixture",
      private: true,
      owner: { login: "kostyniuk" },
    },
    sender: { id: 7, login: "reviewer", type: "User" },
    pull_request: {
      id: 420,
      number,
      title: "Close-time eval fixture",
      body: "A deterministic fixture PR.",
      state: "closed",
      draft: false,
      merged: true,
      user: { id: 7, login: "reviewer", type: "User" },
      base: {
        ref: "main",
        sha: baseSha,
        repo: { full_name: "kostyniuk/fixture", default_branch: "main" },
      },
      head: {
        ref: "feature",
        sha: headSha,
        repo: { full_name: "kostyniuk/fixture" },
      },
    },
  });
  return t.target.fetch("/eve/v1/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-delivery": `pr-close-${number}-${crypto.randomUUID()}`,
      "x-github-event": "pull_request",
      "x-hub-signature-256": sign(body),
    },
    body,
  });
}

async function waitForClose(
  t: EveEvalContext,
  dao: ReturnType<typeof createReviewRecordDao>,
  number: number,
  recordId: string,
) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const records = await dao.listForPullRequest(repositoryId, number);
    const record = records.find(({ id }) => id === recordId);
    if (record?.closeStatus === "completed") return;
    await t.sleep(100);
  }
  throw new Error("Timed out waiting for PR-close processing.");
}

async function startGitHubApiStub(): Promise<{
  close(): Promise<void>;
  graphqlCalls(): number;
}> {
  let graphqlCalls = 0;
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && request.url?.endsWith("/reviews?per_page=100&page=1")) {
      response.end(JSON.stringify(Array.from({ length: 100 }, () => ({}))));
      return;
    }
    if (request.method === "GET" && request.url?.endsWith("/reviews?per_page=100&page=2")) {
      response.end(
        JSON.stringify([
          {
            id: 77,
            node_id: "PRR_REVIEW",
            commit_id: reviewedSha,
            body: "Review body\n\n<!-- evee:formal-review -->",
          },
        ]),
      );
      return;
    }
    if (
      request.method === "GET" &&
      request.url?.endsWith("/reviews/77/comments?per_page=100&page=1")
    ) {
      response.end(JSON.stringify(Array.from({ length: 100 }, () => ({}))));
      return;
    }
    if (
      request.method === "GET" &&
      request.url?.endsWith("/reviews/77/comments?per_page=100&page=2")
    ) {
      response.end(
        JSON.stringify([
          {
            node_id: "PRRC_FINDING",
            body: "**Handle the empty input**\n\nThe empty-input path returns the wrong value.",
          },
        ]),
      );
      return;
    }
    if (request.method === "POST" && request.url === "/graphql") {
      graphqlCalls += 1;
      const body = JSON.parse(await readBody(request)) as { variables?: { id?: string } };
      const isFinding = body.variables?.id === "PRRC_FINDING";
      response.end(
        JSON.stringify({
          data: {
            node: {
              reactions: {
                nodes: [
                  {
                    id: isFinding
                      ? `R_FINDING_${pullRequestNumber}`
                      : `R_REVIEW_${pullRequestNumber}`,
                    content: isFinding ? "THUMBS_DOWN" : "THUMBS_UP",
                    createdAt: "2026-08-14T12:00:00Z",
                    user: { login: isFinding ? "finding-judge" : "review-judge" },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      );
      return;
    }
    if (request.method === "GET" && request.url?.includes("/compare/")) {
      response.end(
        JSON.stringify({
          files: [
            {
              filename: "agent/example.ts",
              patch: request.url.includes(mergedSha) ? "+after-close-fix" : "+as-reviewed",
            },
          ],
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: `Unhandled ${request.method} ${request.url}` }));
  });
  await listen(server, 43_119);
  return {
    graphqlCalls: () => graphqlCalls,
    close: () => close(server),
  };
}

type SlackMessage = {
  readonly blocks: string | null;
  readonly channel: string | null;
  readonly metadata: string | null;
};

async function startSlackApiStub(): Promise<{
  close(): Promise<void>;
  evalMessages(): readonly SlackMessage[];
}> {
  const messages: SlackMessage[] = [];
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "POST" && request.url === "/api/chat.postMessage") {
      const body = new URLSearchParams(await readBody(request));
      const metadata = body.get("metadata");
      if (metadata?.includes('"event_type":"eval_comparison"')) {
        messages.push({ blocks: body.get("blocks"), channel: body.get("channel"), metadata });
      }
      response.end(
        JSON.stringify({ ok: true, channel: body.get("channel"), ts: `eval-${messages.length}` }),
      );
      return;
    }
    if (request.method === "POST" && request.url === "/api/conversations.history") {
      response.end(JSON.stringify({ ok: true, messages: [], response_metadata: {} }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false, error: "unhandled" }));
  });
  await listen(server, 43_120);
  return { evalMessages: () => messages, close: () => close(server) };
}

function sign(body: string): string {
  return `sha256=${createHmac("sha256", githubFixture.webhookSecret).update(body).digest("hex")}`;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function listen(server: ReturnType<typeof createServer>, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
