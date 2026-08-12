import { defineTool } from "eve/tools";
import { writeFile } from "eve/tools/defaults";
import { isReview } from "../lib/review-helper";

export default defineTool({
  ...writeFile,
  async execute(input, ctx) {
    if (isReview(ctx.session.auth.current)) {
      throw new Error("File writes are disabled during read-only GitHub reviews.");
    }
    return writeFile.execute(input, ctx);
  },
});
