import { createGitHubChannel } from "#lib/github-channel";
import {
  createSlackNotificationApi,
  type SlackApiCall,
  type SlackResponse,
} from "#lib/review-notification-service";
import { reviewerInstructions } from "#lib/reviewer-instructions";

export const githubFixture = {
  apiBaseUrl: "http://127.0.0.1:43119",
  webhookSecret: "eevee-review-record-fixture-secret",
} as const;

const callFixtureSlackApi: SlackApiCall = async ({ botToken, operation, body }) => {
  const form = new URLSearchParams();
  if (typeof body === "object" && body !== null) {
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
      }
    }
  }

  try {
    const response = await fetch(`http://127.0.0.1:43120/api/${operation}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${String(botToken)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    return (await response.json()) as SlackResponse;
  } catch {
    // Most GitHub evals do not inspect Slack; the ReviewRecord eval starts the
    // HTTP stub and therefore still exercises and asserts the real request.
    return {
      ok: true,
      channel: form.get("channel"),
      ts: `fixture-${Date.now()}`,
    };
  }
};

export default createGitHubChannel({
  apiBaseUrl: githubFixture.apiBaseUrl,
  credentials: {
    installationToken: "fixture-installation-token",
    webhookSecret: githubFixture.webhookSecret,
  },
  instructions: reviewerInstructions,
  notifications: {
    channelId: "C_REVIEW_FIXTURE",
    slack: createSlackNotificationApi("fixture-slack-token", callFixtureSlackApi),
  },
});
