import { connectGitHubCredentials } from "@vercel/connect/eve";

import { createGitHubChannel } from "../lib/github-channel";
import { reviewerInstructions } from "../lib/reviewer-instructions";

export default createGitHubChannel({
  credentials: connectGitHubCredentials("github/eevee"),
  instructions: reviewerInstructions,
});
