import { mockModel } from "eve/evals";

const safeReview = {
  safetyRating: 4,
  summary:
    "Updates a narrowly scoped helper used by a single call path, with no public API or data-model changes.",
  verdict: "Low residual risk; ready for human review.",
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
  summary:
    "Introduces a new branch in the example helper that is meant to return the computed value for callers.",
  verdict: "Correctness defect should be fixed before merging.",
  criteria: {
    security: { rating: 4, reasoning: "No direct security regression is visible." },
    blastRadius: { rating: 2, reasoning: "The defect affects every caller." },
    correctness: { rating: 1, reasoning: "The new branch returns the wrong value." },
    dataSafety: { rating: 3, reasoning: "No persistent writes are introduced." },
    testCoverage: { rating: 1, reasoning: "The defective branch is not covered." },
    readability: { rating: 4, reasoning: "The code remains easy to follow." },
  },
  findings: [
    {
      path: "src/example.ts",
      line: 2,
      side: "RIGHT",
      title: "Return the computed value",
      body: "This returns the fallback for every input. Return `value` here instead.",
    },
  ],
};

export const githubReviewerEvalModel = mockModel(({ lastUserMessage }) =>
  JSON.stringify(
    String(lastUserMessage).includes("[fixture:risky]") ? riskyReview : safeReview,
  ),
);
