import { createGitHubChannel } from "#lib/github-channel";
import { reviewerInstructions } from "#lib/reviewer-instructions";

export const githubFixture = {
  apiBaseUrl: "http://127.0.0.1:43119",
  webhookSecret: "eevee-review-record-fixture-secret",
} as const;

export default createGitHubChannel({
  apiBaseUrl: githubFixture.apiBaseUrl,
  credentials: {
    installationToken: "fixture-installation-token",
    webhookSecret: githubFixture.webhookSecret,
  },
  instructions: reviewerInstructions,
});
