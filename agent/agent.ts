import { defineAgent } from "eve";
import { openai } from "@ai-sdk/openai";
import { reviewModelId } from "./lib/review-config";

export default defineAgent({
  model: openai(reviewModelId),
  reasoning: "medium",
});
