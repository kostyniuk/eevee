import { defineEval } from "eve/evals";
import { equals, satisfies } from "eve/evals/expect";

import { dispatchPullRequest, pullRequestPayload } from "./harness";

export default defineEval({
  description: "A risky PR receives an advisory Review with one inline Finding.",
  async test(t) {
    const payload = pullRequestPayload({ fixture: "risky" });
    const review = await dispatchPullRequest(t, payload);
    if (!review) throw new Error("Expected a captured Review.");

    t.check(review.body.event, equals("COMMENT"));
    t.check(
      review.body.body,
      satisfies(
        (body) => typeof body === "string" && body.includes("Safety Rating: 2/5"),
        "low Safety Rating",
      ),
    );
    t.check(
      review.body.comments,
      satisfies(
        (comments) =>
          Array.isArray(comments) &&
          comments.length === 1 &&
          comments[0]?.path === "agent/example.ts" &&
          comments[0]?.line === 12,
        "one anchored inline Finding",
      ),
    );
  },
});
