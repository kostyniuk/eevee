import { connectGitHubCredentials, connectSlackCredentials } from "@vercel/connect/eve";

import { createGitHubChannel } from "../lib/github-channel";
import { createSlackReviewNotificationClient } from "../lib/review-notification-delivery";
import { reviewerInstructions } from "../lib/reviewer-instructions";

const channelId = process.env.SLACK_REVIEW_CHANNEL_ID?.trim();
if (!channelId) {
  throw new Error("SLACK_REVIEW_CHANNEL_ID is required for Review notifications.");
}

export default createGitHubChannel({
  credentials: connectGitHubCredentials("github/eevee"),
  instructions: reviewerInstructions,
  notifications: {
    channelId,
    client: createSlackReviewNotificationClient(
      connectSlackCredentials("slack/eevee").botToken,
    ),
  },
});
