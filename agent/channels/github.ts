import { connectGitHubCredentials, connectSlackCredentials } from "@vercel/connect/eve";

import { createGitHubChannel } from "../lib/github-channel";
import { createSlackNotificationApi } from "../lib/review-notification-service";
import { reviewerInstructions } from "../lib/reviewer-instructions";

// Wires the GitHub channel: Connect credentials + Slack notification client.
// Review publishing lives in lib/github-channel.ts, not here.
const channelId = process.env.SLACK_REVIEW_CHANNEL_ID?.trim();
if (!channelId) {
  throw new Error("SLACK_REVIEW_CHANNEL_ID is required for Review notifications.");
}

export default createGitHubChannel({
  credentials: connectGitHubCredentials("github/eevee"),
  instructions: reviewerInstructions,
  notifications: {
    channelId,
    slack: createSlackNotificationApi(connectSlackCredentials("slack/eevee").botToken),
  },
});
