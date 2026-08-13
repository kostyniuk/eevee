import { createHmac, randomBytes, randomInt } from "node:crypto";
import { createServer } from "node:http";

import { defineEval, type EveEvalContext } from "eve/evals";
import { equals, includes } from "eve/evals/expect";

import { createReviewRecordStore } from "#lib/review-record-store";
import { getReviewerInstructions, reviewerInstructions } from "#lib/reviewer-instructions";
import { githubFixture } from "../../agent/channels/github";

const repositoryId = 91_337;
const pullRequestNumber = randomInt(10_000, 1_000_000);
const rejectedPullRequestNumber = pullRequestNumber + 1;
const baseSha = "a".repeat(40);
const headSha = randomBytes(20).toString("hex");

export default defineEval({
  description: "An opened PR persists the complete review in real Postgres.",
  async test(t) {
    const api = await startGitHubApiStub();
    const store = createReviewRecordStore();

    try {
      const response = await sendPullRequest(t, pullRequestNumber);
      t.check(response.status, equals(200));

      const record = await waitForRecord(t, store);
      t.check(record.repository, equals("kostyniuk/fixture"));
      t.check(record.pullRequestNumber, equals(pullRequestNumber));
      t.check(record.reviewedCommitSha, equals(headSha));
      t.check(record.model, equals(reviewerInstructions.model));
      t.check(record.instructionsSource, equals("model"));
      t.check(record.instructionsVersion, equals(reviewerInstructions.version));
      t.check(record.instructionsVersion, includes(/^[a-f0-9]{64}$/u));
      t.check(record.criteria.security.rating, equals(4));
      t.check(record.criteria.correctness.rating, equals(1));
      t.check(record.safetyRating, equals(2));
      t.check(record.findings.length, equals(1));
      t.check(record.findings[0]?.path, equals("agent/example.ts"));
      t.check(api.reviewCount(), equals(1));

      api.rejectReviews();
      const rejectedResponse = await sendPullRequest(t, rejectedPullRequestNumber);
      t.check(rejectedResponse.status, equals(200));
      await waitForReviewAttempt(t, api, 2);
      await t.sleep(250);
      const rejectedRecords = await store.listForPullRequest(
        repositoryId,
        rejectedPullRequestNumber,
      );
      t.check(rejectedRecords.length, equals(0));

      const replacement = await store.create({
        sourceTurnId: `eval:${randomBytes(12).toString("hex")}`,
        repositoryId,
        repository: record.repository,
        pullRequestNumber,
        reviewedCommitSha: "c".repeat(40),
        instructions: reviewerInstructions,
        review: {
          safetyRating: 4,
          verdict: "The follow-up is safe.",
          criteria: record.criteria,
          findings: [],
        },
      });
      const records = await store.listForPullRequest(repositoryId, pullRequestNumber);
      const superseded = records.find(({ id }) => id === record.id);
      t.check(replacement.status, equals("active"));
      t.check(superseded?.status, equals("superseded"));
      t.check(superseded?.supersededById, equals(replacement.id));

      const fallback = getReviewerInstructions("some-provider/future-model");
      t.check(fallback.source, equals("general"));
      t.check(fallback.version, includes(/^[a-f0-9]{64}$/u));
    } finally {
      await store.close();
      await api.close();
    }
  },
});

function sendPullRequest(t: EveEvalContext, number: number) {
  const body = JSON.stringify(openedPullRequestPayload(number));
  return t.target.fetch("/eve/v1/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-delivery": `review-record-${number}-${Date.now()}`,
      "x-github-event": "pull_request",
      "x-hub-signature-256": sign(body),
    },
    body,
  });
}

async function waitForRecord(t: EveEvalContext, store: ReturnType<typeof createReviewRecordStore>) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const records = await store.listForPullRequest(repositoryId, pullRequestNumber);
    const record = records.find((candidate) => candidate.reviewedCommitSha === headSha);
    if (record) return record;
    await t.sleep(250);
  }

  throw new Error("Timed out waiting for the ReviewRecord row.");
}

function sign(body: string): string {
  return `sha256=${createHmac("sha256", githubFixture.webhookSecret).update(body).digest("hex")}`;
}

function openedPullRequestPayload(number: number = pullRequestNumber) {
  return {
    action: "opened",
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
      title: "Exercise persistence",
      body: "A deterministic fixture PR.",
      state: "open",
      draft: false,
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
  };
}

async function startGitHubApiStub(): Promise<{
  close(): Promise<void>;
  rejectReviews(): void;
  reviewAttempts(): number;
  reviewCount(): number;
}> {
  let attempts = 0;
  let rejectReviews = false;
  let reviews = 0;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && request.url?.includes("/compare/")) {
      response.end(
        JSON.stringify({
          files: [
            {
              filename: "agent/example.ts",
              status: "modified",
              additions: 2,
              deletions: 1,
              patch: "@@ -11,1 +11,2 @@\n-old\n+new\n+newer",
            },
          ],
        }),
      );
      return;
    }

    const pullRequestMatch = request.url?.match(/\/pulls\/(\d+)$/u);
    if (request.method === "GET" && pullRequestMatch) {
      response.end(
        JSON.stringify(openedPullRequestPayload(Number(pullRequestMatch[1])).pull_request),
      );
      return;
    }

    if (request.method === "POST" && request.url?.endsWith("/reviews")) {
      attempts += 1;
      if (rejectReviews) {
        response.statusCode = 500;
        response.end(JSON.stringify({ error: "Fixture rejected review" }));
        return;
      }
      reviews += 1;
      response.statusCode = 201;
      response.end(JSON.stringify({ id: reviews }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: `Unhandled ${request.method} ${request.url}` }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(43_119, "127.0.0.1", resolve);
  });

  return {
    rejectReviews: () => {
      rejectReviews = true;
    },
    reviewAttempts: () => attempts,
    reviewCount: () => reviews,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function waitForReviewAttempt(
  t: EveEvalContext,
  api: { reviewAttempts(): number },
  count: number,
) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (api.reviewAttempts() >= count) return;
    await t.sleep(250);
  }

  throw new Error("Timed out waiting for the GitHub review request.");
}
