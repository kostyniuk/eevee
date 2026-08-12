import { z } from "zod";

const criterionSchema = z.object({
  rating: z.number().int().min(0).max(5),
  reasoning: z.string().trim().min(1),
});

const reviewSchema = z.object({
  safetyRating: z.number().int().min(0).max(5),
  verdict: z.string().trim().min(1),
  criteria: z.object({
    security: criterionSchema,
    blastRadius: criterionSchema,
    correctness: criterionSchema,
    dataSafety: criterionSchema,
    testCoverage: criterionSchema,
    readability: criterionSchema,
  }),
  findings: z.array(
    z.object({
      path: z.string().trim().min(1),
      line: z.number().int().positive(),
      side: z.enum(["LEFT", "RIGHT"]),
      startLine: z.number().int().positive().optional(),
      title: z.string().trim().min(1),
      body: z.string().trim().min(1),
    }),
  ),
});

export type Review = z.infer<typeof reviewSchema>;

const criterionLabels: ReadonlyArray<readonly [keyof Review["criteria"], string]> = [
  ["security", "Security"],
  ["blastRadius", "Blast radius"],
  ["correctness", "Correctness"],
  ["dataSafety", "Data safety"],
  ["testCoverage", "Test coverage"],
  ["readability", "Readability"],
];

export function parseReview(message: string): Review {
  const trimmed = message.trim();
  const json = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  const review = reviewSchema.parse(JSON.parse(json));

  if (review.safetyRating >= 3 && review.findings.length > 0) {
    return { ...review, findings: [] };
  }

  return review;
}

export function formatReviewBody(review: Review): string {
  const criteria = criterionLabels
    .map(([key, label]) => {
      const result = review.criteria[key];
      return `| ${label} | ${result.rating}/5 | ${result.reasoning.replaceAll("|", "\\|")} |`;
    })
    .join("\n");

  return [
    `## Safety Rating: ${review.safetyRating}/5`,
    "",
    review.verdict,
    "",
    "| Review Criterion | Rating | Reasoning |",
    "| --- | ---: | --- |",
    criteria,
    "",
    "_Advisory review only — this review does not block merging._",
    "",
    "<!-- evee:formal-review -->",
  ].join("\n");
}

export function formatReviewComments(review: Review) {
  if (review.safetyRating >= 3) return [];

  return review.findings.map((finding) => ({
    path: finding.path,
    line: finding.line,
    side: finding.side,
    ...(finding.startLine === undefined
      ? {}
      : { start_line: finding.startLine, start_side: finding.side }),
    body: `**${finding.title}**\n\n${finding.body}`,
  }));
}

type AuthAttributes = Readonly<Record<string, string | readonly string[]>>;

// Marks the turn so reviewer instructions load and delivery posts a Review.
export function reviewAuth<T extends { attributes: AuthAttributes }>(auth: T): T {
  return {
    ...auth,
    attributes: { ...auth.attributes, review: "1" },
  };
}

export function isReview(auth: { attributes: AuthAttributes } | null | undefined): boolean {
  if (!auth) return false;
  const value = auth.attributes.review;
  return (typeof value === "string" ? value : value?.[0]) === "1";
}
