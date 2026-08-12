import { defineDynamic, defineInstructions } from "eve/instructions";
import { isGitHubPrConversation, isReview } from "../lib/review-helper";
import { reviewerInstructions } from "../lib/reviewer-instructions";

export default defineDynamic({
  events: {
    "turn.started"(_event, ctx) {
      const auth = ctx.session.auth.current;
      return isReview(auth) || isGitHubPrConversation(auth)
        ? defineInstructions({ markdown: reviewerInstructions })
        : null;
    },
  },
});
