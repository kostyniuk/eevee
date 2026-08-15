import { execFileSync } from "node:child_process";

import postgres from "postgres";

import {
  buildFindingFocusedComparison,
  type EvalEvidenceV2,
} from "../agent/lib/finding-focused-diff.ts";

type PairRow = {
  readonly id: string;
  readonly reviewRecordId: string;
  readonly pullRequestNumber: number;
  readonly pullRequestTitle: string | null;
  readonly evidenceVersion: string | null;
  readonly beforeDiff: DiffReference;
  readonly afterDiff: DiffReference;
  readonly findings: readonly {
    readonly id: string;
    readonly path: string;
    readonly line: number;
    readonly side: "LEFT" | "RIGHT";
    readonly startLine?: number;
    readonly title: string;
    readonly body: string;
  }[];
};

type DiffReference = {
  readonly repository: string;
  readonly baseSha: string;
  readonly headSha: string;
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const githubToken = process.env.GITHUB_TOKEN?.trim() || readGitHubCliToken();
const db = postgres(databaseUrl, { max: 1, prepare: false });

try {
  const pairs = await db<PairRow[]>`
    select
      pair.id,
      record.id as "reviewRecordId",
      record.pull_request_number as "pullRequestNumber",
      record.pull_request_title as "pullRequestTitle",
      pair.evidence ->> 'version' as "evidenceVersion",
      pair.before_diff as "beforeDiff",
      pair.after_diff as "afterDiff",
      record.findings
    from eval_pairs pair
    inner join review_records record on record.id = pair.review_record_id
    where pair.evidence is null
      or pair.evidence ->> 'version' <> '2'
      or record.pull_request_title is null
    order by pair.created_at
  `;

  let storedEvidence = 0;
  let storedTitles = 0;
  for (const pair of pairs) {
    if (pair.evidenceVersion !== "2") {
      const focused =
        pair.findings.length > 0
          ? await buildFindingFocusedComparison({
              request: requestGitHub,
              repository: pair.beforeDiff.repository,
              baseSha: pair.beforeDiff.baseSha,
              reviewedSha: pair.beforeDiff.headSha,
              finalSha: pair.afterDiff.headSha,
              findings: pair.findings,
            })
          : null;
      const evidence =
        focused ?? (await buildFullPatchEvidence(pair.beforeDiff, pair.afterDiff, pair.findings));
      await db`update eval_pairs set evidence = ${db.json(evidence)} where id = ${pair.id}`;
      storedEvidence += 1;
    }

    if (!pair.pullRequestTitle) {
      const title = await fetchPullRequestTitle(pair.beforeDiff.repository, pair.pullRequestNumber);
      await db`
        update review_records
        set pull_request_title = ${title}
        where id = ${pair.reviewRecordId} and pull_request_title is null
      `;
      storedTitles += 1;
    }
  }
  console.log(`Stored v2 evidence for ${storedEvidence} pair(s) and ${storedTitles} title(s).`);
} finally {
  await db.end();
}

async function requestGitHub<T>(input: {
  readonly method: "GET";
  readonly path: string;
}): Promise<{ readonly body: T }> {
  const response = await fetch(`https://api.github.com${input.path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${input.path}`);
  return { body: (await response.json()) as T };
}

async function buildFullPatchEvidence(
  before: DiffReference,
  after: DiffReference,
  findings: PairRow["findings"],
): Promise<EvalEvidenceV2> {
  const [beforeText, afterText] = await Promise.all([
    fetchFullPatch(before),
    fetchFullPatch(after),
  ]);
  const beforeChunks = chunkText(beforeText, 2_600);
  const afterChunks = chunkText(afterText, 2_600);
  return {
    version: 2,
    mode: "full-patch",
    findings: findings.map((finding) => ({
      findingId: finding.id,
      title: finding.title,
      before: beforeChunks,
      after: afterChunks,
    })),
  };
}

async function fetchPullRequestTitle(repository: string, number: number): Promise<string> {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) throw new Error(`Invalid repository: ${repository}`);
  const response = await requestGitHub<{ readonly title?: unknown }>({
    method: "GET",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`,
  });
  return typeof response.body.title === "string" && response.body.title.trim()
    ? response.body.title.trim()
    : `Pull request #${number}`;
}

async function fetchFullPatch(ref: DiffReference): Promise<string> {
  const [owner, repo] = ref.repository.split("/");
  if (!owner || !repo) throw new Error(`Invalid repository: ${ref.repository}`);
  const response = await requestGitHub<{ readonly files?: readonly unknown[] }>({
    method: "GET",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${ref.baseSha}...${ref.headSha}`,
  });
  const files = Array.isArray(response.body.files) ? response.body.files : [];
  const patches = files.flatMap((value) => {
    if (!isObject(value) || typeof value.filename !== "string") return [];
    const patch = typeof value.patch === "string" ? value.patch : "Patch unavailable.";
    return [`--- ${value.filename}\n${patch}`];
  });
  return patches.join("\n\n") || "No patch was available for this side.";
}

function chunkText(value: string, maximum: number): readonly string[] {
  const chunks: string[] = [];
  let rest = value;
  while (rest.length > maximum) {
    const newline = rest.lastIndexOf("\n", maximum);
    const end = newline > 0 ? newline : maximum;
    chunks.push(rest.slice(0, end));
    rest = rest.slice(end + (newline > 0 ? 1 : 0));
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readGitHubCliToken(): string | undefined {
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}
