import { defineTool } from "eve/tools";
import { bash } from "eve/tools/defaults";
import { isReview } from "../lib/review-helper";

export default defineTool({
  ...bash,
  async execute(input, ctx) {
    if (isReview(ctx.session.auth.current)) {
      throw new Error("Shell commands are disabled during read-only GitHub reviews.");
    }
    return bash.execute(input, ctx);
  },
});
