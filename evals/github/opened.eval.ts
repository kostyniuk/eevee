import { defineEval } from "eve/evals";
import { equals, satisfies } from "eve/evals/expect";
import { dispatchPullRequest, pullRequestPayload } from "./harness";

export default [
  defineEval({
    description: "A safe PR receives one advisory summary-only review.",
    async test(t) {
      const review = await dispatchPullRequest(t, pullRequestPayload({ fixture: "safe" }), {
        expectReview: true,
      });
      if (!review) throw new Error("Expected a captured review");

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
      t.check("commit_id" in review.body, equals(true));
    },
  }),
  defineEval({
    description: "A risky PR receives inline Findings in an advisory review.",
    async test(t) {
      const review = await dispatchPullRequest(t, pullRequestPayload({ fixture: "risky" }), {
        expectReview: true,
      });
      if (!review) throw new Error("Expected a captured review");

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
            comments[0]?.path === "src/example.ts" &&
            comments[0]?.line === 2,
          "one anchored inline Finding",
        ),
      );
    },
  }),
];
