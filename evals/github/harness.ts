import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { EveEvalContext } from "eve/evals";
import { equals, satisfies } from "eve/evals/expect";

// Fake GitHub HTTP API for edge evals. Eve posts the formal review here;
// we capture POST /pulls/7/reviews and assert event=COMMENT + commit_id.
const apiPort = 43_119;
const webhookSecret = "eevee-eval-secret";

export interface CapturedReview {
  readonly authorization: string | undefined;
  readonly body: Record<string, unknown>;
  readonly method: string | undefined;
  readonly url: string | undefined;
}

export function pullRequestPayload(options: {
  readonly draft?: boolean;
  readonly fixture?: "risky" | "safe";
}) {
  const fixture = options.fixture ?? "safe";
  return {
    action: "opened",
    installation: { id: 12345 },
    number: 7,
    pull_request: {
      id: 700,
      number: 7,
      title: `[fixture:${fixture}] Example change`,
      body: "Synthetic pull request for the edge harness.",
      state: "open",
      draft: options.draft ?? false,
      html_url: "https://github.com/acme/widget/pull/7",
      user: { id: 22, login: "octocat", type: "User" },
      base: {
        ref: "main",
        sha: "1111111111111111111111111111111111111111",
        repo: { full_name: "acme/widget", default_branch: "main" },
      },
      head: {
        ref: "feature",
        sha: "2222222222222222222222222222222222222222",
        repo: { full_name: "acme/widget" },
      },
    },
    repository: {
      id: 99,
      name: "widget",
      full_name: "acme/widget",
      private: true,
      default_branch: "main",
      owner: { login: "acme" },
    },
    sender: { id: 22, login: "octocat", type: "User" },
  };
}

export async function dispatchPullRequest(
  t: EveEvalContext,
  payload: ReturnType<typeof pullRequestPayload>,
  options: { readonly expectReview: boolean },
): Promise<CapturedReview | null> {
  const reviews: CapturedReview[] = [];
  let resolveReview: ((review: CapturedReview) => void) | undefined;
  const reviewReceived = new Promise<CapturedReview>((resolve) => {
    resolveReview = resolve;
  });

  const server = createServer(async (request, response) => {
    if (request.method === "POST" && request.url?.endsWith("/pulls/7/reviews")) {
      const review: CapturedReview = {
        authorization: request.headers.authorization,
        body: JSON.parse(await readBody(request)) as Record<string, unknown>,
        method: request.method,
        url: request.url,
      };
      reviews.push(review);
      resolveReview?.(review);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: 456 }));
      return;
    }

    if (request.method === "GET" && request.url?.includes("/pulls/7")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(githubPullRequestResponse(payload)));
      return;
    }

    if (request.method === "GET" && request.url?.includes("/compare/")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ files: [githubFileResponse()] }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end("[]");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(apiPort, "127.0.0.1", resolve);
  });

  try {
    const body = JSON.stringify(payload);
    const response = await t.target.fetch("/eve/v1/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": `eval-${crypto.randomUUID()}`,
        "x-github-event": "pull_request",
        "x-hub-signature-256": sign(body),
      },
      body,
    });
    t.check(response.status, equals(200));

    if (!options.expectReview) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      t.check(reviews.length, equals(0));
      return null;
    }

    const review = await Promise.race([
      reviewReceived,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timed out waiting for the GitHub review")), 15_000),
      ),
    ]);
    t.check(reviews.length, equals(1));
    t.check(review.authorization, equals("Bearer eval-installation-token"));
    t.check(
      review.url,
      satisfies((url) => url === "/repos/acme/widget/pulls/7/reviews", "formal review endpoint"),
    );
    return review;
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function sign(body: string): string {
  return `sha256=${createHmac("sha256", webhookSecret).update(body).digest("hex")}`;
}

function githubPullRequestResponse(payload: ReturnType<typeof pullRequestPayload>) {
  return {
    ...payload.pull_request,
    additions: 2,
    deletions: 1,
    changed_files: 1,
    mergeable: true,
  };
}

function githubFileResponse() {
  return {
    filename: "src/example.ts",
    status: "modified",
    additions: 2,
    deletions: 1,
    changes: 3,
    patch: "@@ -1,2 +1,3 @@\n export function example(value: string) {\n+  return 'fallback';\n }",
  };
}
