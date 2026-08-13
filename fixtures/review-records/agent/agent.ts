import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

import { reviewModelId } from "#lib/review-config";

const safeReview = {
  safetyRating: 4,
  verdict: "The focused change is low risk and ready for human review.",
  criteria: {
    security: { rating: 5, reasoning: "No security boundary changes." },
    blastRadius: { rating: 4, reasoning: "The change is narrowly scoped." },
    correctness: { rating: 4, reasoning: "The changed behavior is coherent." },
    dataSafety: { rating: 5, reasoning: "No persistent data is changed." },
    testCoverage: { rating: 3, reasoning: "Coverage is proportionate to the change." },
    readability: { rating: 4, reasoning: "The implementation is clear." },
  },
  findings: [],
};

const riskyReview = {
  safetyRating: 2,
  verdict: "The change needs a targeted fix before merging.",
  criteria: {
    security: { rating: 4, reasoning: "No security regression found." },
    blastRadius: { rating: 2, reasoning: "The changed path is shared." },
    correctness: { rating: 1, reasoning: "An edge case is not handled." },
    dataSafety: { rating: 3, reasoning: "No destructive write is introduced." },
    testCoverage: { rating: 1, reasoning: "The edge case has no test." },
    readability: { rating: 4, reasoning: "The change is otherwise clear." },
  },
  findings: [
    {
      path: "agent/example.ts",
      line: 12,
      side: "RIGHT",
      title: "Handle the empty input",
      body: "Return early when the input is empty and cover it with a test.",
    },
  ],
};

export default defineAgent({
  model: mockModel({
    provider: "openai",
    modelId: reviewModelId,
    respond: ({ lastUserMessage }) =>
      JSON.stringify(String(lastUserMessage).includes("[fixture:safe]") ? safeReview : riskyReview),
  }),
  reasoning: "medium",
});
