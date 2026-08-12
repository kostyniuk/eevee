import { connectGitHubCredentials } from "@vercel/connect/eve";
import {
  defaultGitHubAuth,
  githubChannel,
  type GitHubChannelCredentials,
} from "eve/channels/github";
import {
  formatReviewBody,
  formatReviewComments,
  isReview,
  parseReview,
  reviewAuth,
} from "../lib/review-helper";

const botName = "eevee-agent";
const mentioned = new RegExp(`@${escapeRegExp(botName)}(?=$|[^A-Za-z0-9_-])`, "iu");
const isEval = process.env.EEVEE_GITHUB_EVAL === "1";
const credentials: GitHubChannelCredentials = isEval
  ? {
      installationToken: "eval-installation-token",
      webhookSecret: process.env.EEVEE_GITHUB_WEBHOOK_SECRET ?? "eevee-eval-secret",
    }
  : connectGitHubCredentials("github/eevee");

export default githubChannel({
  botName,
  credentials,
  api: isEval
    ? { apiBaseUrl: process.env.EEVEE_GITHUB_API_URL ?? "http://127.0.0.1:43119" }
    : undefined,
  onPullRequest(ctx, pullRequest) {
    if (pullRequest.action !== "opened" || pullRequest.raw.draft === true) return null;

    return {
      auth: reviewAuth(defaultGitHubAuth(ctx)),
      context: [
        "Perform the read-only pull request review now. Return only the JSON review object required by the Reviewer Instructions.",
      ],
    };
  },
  onComment(ctx, comment) {
    if (!mentioned.test(comment.body)) return null;

    return {
      auth: defaultGitHubAuth(ctx),
      context: [
        "Answer this comment as the helpful assistant. Do not produce a formal pull-request review or the JSON review object.",
      ],
    };
  },
  events: {
    async "message.completed"(data, channel, ctx) {
      if (data.finishReason === "tool-calls" || !data.message) return;

      const pullRequestNumber = channel.conversation.pullRequestNumber;
      if (!isReview(ctx.session.auth.current) || pullRequestNumber === null) {
        await channel.thread.post(data.message);
        return;
      }

      const review = parseReview(data.message);
      await channel.github.request({
        method: "POST",
        path: `/repos/${encodeURIComponent(channel.repository.owner)}/${encodeURIComponent(channel.repository.name)}/pulls/${pullRequestNumber}/reviews`,
        body: {
          event: "COMMENT",
          body: formatReviewBody(review),
          ...(channel.state.headSha ? { commit_id: channel.state.headSha } : {}),
          comments: formatReviewComments(review),
        },
      });
    },
  },
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
