import { z } from "zod";

import { reviewerInstructions } from "./reviewer-instructions";

const criterionSchema = z.object({
  rating: z.number().int().min(0).max(5),
  reasoning: z.string().trim().min(1),
});

const reviewSchema = z.object({
  safetyRating: z.number().int().min(0).max(5),
  /** What the PR changes (main idea of the diff), not the risk judgment. */
  summary: z.string().trim().min(1),
  /** Short review judgment — residual risk and whether human attention is warranted. */
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

const criteriaMeta: ReadonlyArray<{
  readonly key: keyof Review["criteria"];
  readonly label: string;
  readonly emoji: string;
}> = [
  { key: "security", label: "Security", emoji: "🔒" },
  { key: "blastRadius", label: "Blast radius", emoji: "💥" },
  { key: "correctness", label: "Correctness", emoji: "✅" },
  { key: "dataSafety", label: "Data safety", emoji: "💾" },
  { key: "testCoverage", label: "Test coverage", emoji: "🧪" },
  { key: "readability", label: "Readability", emoji: "📖" },
];

function criterionDisplay(meta: (typeof criteriaMeta)[number]): string {
  return `${meta.emoji} ${meta.label}`;
}

export function parseReview(message: string): Review {
  const trimmed = message.trim();
  const json = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  const review = reviewSchema.parse(JSON.parse(json));

  if (review.safetyRating >= reviewerInstructions.findingThreshold && review.findings.length > 0) {
    return { ...review, findings: [] };
  }

  return review;
}

export function tryParseReview(message: string): Review | null {
  try {
    return parseReview(message);
  } catch {
    return null;
  }
}

export function formatReviewBody(review: Review): string {
  // Compact table = short cells only (GitHub crushes columns when any cell is
  // long). Full criterion reasoning lives under a collapsible <details>.
  const band = safetyBand(review.safetyRating);
  const weakest = weakestCriterion(review);
  const findingsCell = formatFindingsCell(review);

  const criteriaDetails = criteriaMeta
    .map((meta) => {
      const result = review.criteria[meta.key];
      return `**${criterionDisplay(meta)} · ${result.rating}/5**\n\n${sanitizeDetailsContent(result.reasoning)}`;
    })
    .join("\n\n");

  const summary = collapseWhitespace(review.summary);
  const verdict = collapseWhitespace(review.verdict);

  return [
    `## 🛡️ Safety Rating: ${review.safetyRating}/5 · ${band}`,
    "",
    `| Safety Rating | Weakest criterion | Findings |`,
    `| --- | --- | --- |`,
    `| **${review.safetyRating}/5** · ${band} | ${criterionDisplay(weakest)} · ${weakest.rating}/5 | ${findingsCell} |`,
    "",
    `**📝 Summary:** ${summary}`,
    "",
    `**⚖️ Verdict:** ${verdict}`,
    "",
    "<details>",
    `<summary>Review details · ${criteriaMeta.length} criteria</summary>`,
    "",
    criteriaDetails,
    "",
    "</details>",
    "",
    "_Advisory review only — this review does not block merging._",
    "",
    "<!-- evee:formal-review -->",
  ].join("\n");
}

/** Inline findings only apply below the threshold; at/above is summary-only by design. */
function formatFindingsCell(review: Review): string {
  if (review.safetyRating >= reviewerInstructions.findingThreshold) {
    return "Summary only";
  }
  const count = review.findings.length;
  if (count === 0) return "0";
  return `${count} inline`;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function safetyBand(rating: number): string {
  switch (rating) {
    case 5:
      return "Safe";
    case 4:
      return "Low risk";
    case 3:
      return "Moderate";
    case 2:
      return "Significant";
    case 1:
      return "High risk";
    case 0:
      return "Critical";
    default:
      return "Unknown";
  }
}

function weakestCriterion(review: Review): (typeof criteriaMeta)[number] & { rating: number } {
  let weakest = criteriaMeta[0]!;
  let weakestRating = review.criteria[weakest.key].rating;

  for (const meta of criteriaMeta) {
    const rating = review.criteria[meta.key].rating;
    if (rating < weakestRating) {
      weakest = meta;
      weakestRating = rating;
    }
  }

  return { ...weakest, rating: weakestRating };
}

/** Keep <details> intact if model text accidentally includes the closing tag. */
function sanitizeDetailsContent(text: string): string {
  return text.replaceAll(/<\/details>/giu, "</ details>");
}

export function formatReviewComments(review: Review) {
  if (review.safetyRating >= reviewerInstructions.findingThreshold) return [];

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

// Marks an opened-PR turn so reviewer instructions are required, not optional.
export function reviewAuth<T extends { attributes: AuthAttributes }>(auth: T): T {
  return {
    ...auth,
    attributes: { ...auth.attributes, review: "1" },
  };
}

export function isReview(auth: { attributes: AuthAttributes } | null | undefined): boolean {
  return authAttribute(auth?.attributes, "review") === "1";
}

export function isGitHubPrConversation(
  auth: { authenticator: string; attributes: AuthAttributes } | null | undefined,
): boolean {
  if (auth?.authenticator !== "github-webhook") return false;
  const kind = authAttribute(auth.attributes, "conversation_kind");
  return kind === "pull_request" || kind === "review_thread";
}

function authAttribute(attributes: AuthAttributes | undefined, key: string): string | undefined {
  const value = attributes?.[key];
  return typeof value === "string" ? value : value?.[0];
}
