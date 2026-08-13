import { defineEval } from "eve/evals";
import { equals, satisfies } from "eve/evals/expect";

import { dispatchPullRequest, pullRequestPayload } from "./harness";

export default defineEval({
  description: "A safe PR receives one advisory summary-only Review.",
  async test(t) {
    const payload = pullRequestPayload({ fixture: "safe" });
    const review = await dispatchPullRequest(t, payload);
    if (!review) throw new Error("Expected a captured Review.");

    t.check(review.body.event, equals("COMMENT"));
    t.check(
      review.body.body,
      satisfies(
        (body) =>
          typeof body === "string" &&
          body.includes("Safety Rating: 4/5") &&
          body.includes("| Security |"),
        "rating and criterion reasoning",
      ),
    );
    t.check(review.body.comments, equals([]));
    t.check(review.body.commit_id, equals(payload.pull_request.head.sha));
  },
});
