import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

import { reviewModelId } from "#lib/review-config";

export default defineAgent({
  model: mockModel({
    provider: "openai",
    modelId: reviewModelId,
    respond: JSON.stringify({
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
    }),
  }),
  reasoning: "medium",
});
