import { defineEval } from "eve/evals";

import { dispatchPullRequest, pullRequestPayload } from "./harness";

export default defineEval({
  description: "A draft PR does not produce a Review.",
  async test(t) {
    await dispatchPullRequest(t, pullRequestPayload({ draft: true }));
  },
});
