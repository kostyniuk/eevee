import { defineDynamic, defineInstructions } from "eve/instructions";
import { isReview } from "../lib/review-helper";
import { reviewerInstructions } from "../lib/reviewer-instructions";

export default defineDynamic({
  events: {
    "turn.started"(_event, ctx) {
      return isReview(ctx.session.auth.current)
        ? defineInstructions({ markdown: reviewerInstructions })
        : null;
    },
  },
});
