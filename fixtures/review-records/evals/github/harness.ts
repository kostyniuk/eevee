import { createHmac, randomInt } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";

import type { EveEvalContext } from "eve/evals";
import { equals } from "eve/evals/expect";

import { githubFixture } from "../../agent/channels/github";

export type CapturedReview = {
  readonly authorization: string | undefined;
  readonly body: Record<string, unknown>;
  readonly method: string | undefined;
  readonly url: string | undefined;
};

export function pullRequestPayload(options: {
  readonly draft?: boolean;
  readonly fixture?: "risky" | "safe";
}) {
  const number = randomInt(10_000, 1_000_000);
  const fixture = options.fixture ?? "safe";

  return {
    action: "opened",
    installation: { id: 123 },
    repository: {
      id: 91_337,
      name: "fixture",
      full_name: "kostyniuk/fixture",
      private: true,
      owner: { login: "kostyniuk" },
    },
    sender: { id: 7, login: "reviewer", type: "User" },
    pull_request: {
      id: number,
      number,
      title: `[fixture:${fixture}] Example change`,
      body: "Synthetic pull request for the edge eval.",
      state: "open",
      draft: options.draft ?? false,
      user: { id: 7, login: "reviewer", type: "User" },
      base: {
        ref: "main",
        sha: "1".repeat(40),
        repo: { full_name: "kostyniuk/fixture", default_branch: "main" },
      },
      head: {
        ref: "feature",
        sha: "2".repeat(40),
        repo: { full_name: "kostyniuk/fixture" },
      },
    },
  };
}

export async function dispatchPullRequest(
  t: EveEvalContext,
  payload: ReturnType<typeof pullRequestPayload>,
): Promise<CapturedReview | null> {
  const reviews: CapturedReview[] = [];
  let receiveReview: ((review: CapturedReview) => void) | undefined;
  const reviewReceived = new Promise<CapturedReview>((resolve) => {
    receiveReview = resolve;
  });
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");

    if (request.method === "POST" && request.url?.endsWith("/reviews")) {
      const review = {
        authorization: request.headers.authorization,
        body: JSON.parse(await readBody(request)) as Record<string, unknown>,
        method: request.method,
        url: request.url,
      };
      reviews.push(review);
      receiveReview?.(review);
      response.statusCode = 201;
      response.end(JSON.stringify({ id: reviews.length }));
      return;
    }

    if (request.method === "GET" && request.url?.includes("/compare/")) {
      response.end(JSON.stringify({ files: [githubFile()] }));
      return;
    }

    if (request.method === "GET" && request.url?.match(/\/pulls\/\d+$/u)) {
      response.end(JSON.stringify(payload.pull_request));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: `Unhandled ${request.method} ${request.url}` }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(43_119, "127.0.0.1", resolve);
  });

  try {
    const body = JSON.stringify(payload);
    const response = await t.target.fetch("/eve/v1/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": `review-behavior-${payload.pull_request.number}`,
        "x-github-event": "pull_request",
        "x-hub-signature-256": sign(body),
      },
      body,
    });
    t.check(response.status, equals(200));

    if (payload.pull_request.draft) {
      await t.sleep(750);
      t.check(reviews.length, equals(0));
      return null;
    }

    const review = await Promise.race([
      reviewReceived,
      t.sleep(15_000).then(() => {
        throw new Error("Timed out waiting for the GitHub review request.");
      }),
    ]);
    t.check(reviews.length, equals(1));
    t.check(review.authorization, equals("Bearer fixture-installation-token"));
    t.check(review.method, equals("POST"));
    t.check(
      review.url,
      equals(`/repos/kostyniuk/fixture/pulls/${payload.pull_request.number}/reviews`),
    );
    return review;
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function sign(body: string): string {
  return `sha256=${createHmac("sha256", githubFixture.webhookSecret).update(body).digest("hex")}`;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function githubFile() {
  return {
    filename: "agent/example.ts",
    status: "modified",
    additions: 2,
    deletions: 1,
    patch: "@@ -11,1 +11,2 @@\n-old\n+new\n+newer",
  };
}
