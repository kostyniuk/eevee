import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

import { dispatchPullRequest, pullRequestPayload } from "./harness";

export default defineEval({
  description: "A review request on a non-draft PR produces a fresh Review.",
  async test(t) {
    const payload = pullRequestPayload({ action: "review_requested", fixture: "safe" });
    const review = await dispatchPullRequest(t, payload);
    if (!review) throw new Error("Expected a captured Review.");

    t.check(review.body.event, equals("COMMENT"));
    t.check(review.body.commit_id, equals(payload.pull_request.head.sha));
  },
});
