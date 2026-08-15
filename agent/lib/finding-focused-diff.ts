import type { GitHubHandle } from "eve/channels/github";

import type { ReviewRecord } from "./review-record-dao";

type GitHubRequest = GitHubHandle["request"];
type Finding = ReviewRecord["findings"][number];

type DiffFile = {
  readonly filename: string;
  readonly previousFilename: string | null;
  readonly hunks: readonly DiffHunk[];
};

type DiffHunk = {
  readonly header: string;
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newCount: number;
  readonly lines: readonly DiffLine[];
};

type DiffLine = {
  readonly raw: string;
  readonly kind: "context" | "addition" | "deletion";
  readonly oldLine: number | null;
  readonly newLine: number | null;
};

type DiffFocus = {
  readonly kind: "diff";
  readonly file: DiffFile;
  readonly hunk: DiffHunk;
  readonly lineIndex: number;
};

type LocatedLine = DiffFocus & {
  readonly reviewedLine: number;
};

type SourceFocus = {
  readonly kind: "source";
  readonly path: string;
  readonly lines: readonly string[];
  readonly lineIndex: number;
};

type Focus = DiffFocus | SourceFocus;

export type FindingFocusedComparison = {
  readonly before: readonly string[];
  readonly after: readonly string[];
};

/** Build both blind sides from every stored finding, or no comparison if any line is unsafe. */
export async function buildFindingFocusedComparison(input: {
  readonly request: GitHubRequest;
  readonly repository: string;
  readonly baseSha: string;
  readonly reviewedSha: string;
  readonly finalSha: string;
  readonly findings: readonly Finding[];
}): Promise<FindingFocusedComparison | null> {
  if (input.findings.length === 0) return null;

  const [reviewedFiles, transitionFiles, finalFiles] = await Promise.all([
    fetchComparison(input.request, input.repository, input.baseSha, input.reviewedSha),
    fetchComparison(input.request, input.repository, input.reviewedSha, input.finalSha),
    fetchComparison(input.request, input.repository, input.baseSha, input.finalSha),
  ]);
  if (!reviewedFiles || !transitionFiles || !finalFiles) return null;
  const before: Focus[] = [];
  const after: Focus[] = [];
  const sources = new Map<string, Promise<readonly string[] | null>>();

  for (const finding of input.findings) {
    const reviewed = locateFinding(reviewedFiles, finding);
    if (!reviewed) return null;
    const mapped = mapReviewedLine(transitionFiles, reviewed.file.filename, reviewed.reviewedLine);
    if (!mapped) return null;
    const final =
      locateNewLine(finalFiles, mapped.path, mapped.line) ??
      (await locateSourceLine(
        input.request,
        input.repository,
        input.finalSha,
        mapped.path,
        mapped.line,
        sources,
      ));
    if (!final) return null;
    before.push(reviewed);
    after.push(final);
  }

  return { before: renderFocuses(before), after: renderFocuses(after) };
}

async function fetchComparison(
  request: GitHubRequest,
  repository: string,
  baseSha: string,
  headSha: string,
): Promise<readonly DiffFile[] | null> {
  const [owner, repo] = splitRepository(repository);
  const response = await request<{ readonly files?: readonly unknown[] }>({
    method: "GET",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${baseSha}...${headSha}`,
  });
  const files = Array.isArray(response.body?.files) ? response.body.files : [];
  // GitHub caps compare results at 300 files. A partial list cannot prove that all findings map.
  if (files.length >= 300) return null;
  return files.flatMap((value) => {
    if (!isObject(value) || typeof value.filename !== "string") return [];
    return [
      {
        filename: value.filename,
        previousFilename:
          typeof value.previous_filename === "string" ? value.previous_filename : null,
        hunks: typeof value.patch === "string" ? parsePatch(value.patch) : [],
      },
    ];
  });
}

function locateFinding(files: readonly DiffFile[], finding: Finding): LocatedLine | null {
  const file = files.find((candidate) =>
    finding.side === "LEFT"
      ? candidate.previousFilename === finding.path || candidate.filename === finding.path
      : candidate.filename === finding.path,
  );
  if (!file) return null;

  for (const hunk of file.hunks) {
    const lineIndex = hunk.lines.findIndex((line) =>
      finding.side === "LEFT"
        ? line.oldLine === finding.line && line.kind !== "addition"
        : line.newLine === finding.line && line.kind !== "deletion",
    );
    if (lineIndex < 0) continue;
    const line = hunk.lines[lineIndex]!;
    // A removed LEFT-side line has no unambiguous location in the reviewed tree.
    if (line.newLine === null) return null;
    return { kind: "diff", file, hunk, lineIndex, reviewedLine: line.newLine };
  }
  return null;
}

function mapReviewedLine(
  files: readonly DiffFile[],
  path: string,
  reviewedLine: number,
): { readonly path: string; readonly line: number } | null {
  const file = files.find(
    (candidate) => candidate.previousFilename === path || candidate.filename === path,
  );
  if (!file) return { path, line: reviewedLine };
  if (file.hunks.length === 0) return null;

  for (const hunk of file.hunks) {
    const exactIndex = hunk.lines.findIndex((line) => line.oldLine === reviewedLine);
    if (exactIndex >= 0) {
      const exact = hunk.lines[exactIndex]!;
      if (exact.newLine !== null) return { path: file.filename, line: exact.newLine };
      const replacement = replacementLine(hunk.lines, exactIndex);
      return replacement === null ? null : { path: file.filename, line: replacement };
    }
    if (reviewedLine >= hunk.oldStart && reviewedLine < hunk.oldStart + hunk.oldCount) return null;
  }

  let offset = 0;
  for (const hunk of file.hunks) {
    if (hunk.oldStart + hunk.oldCount > reviewedLine) break;
    offset += hunk.newCount - hunk.oldCount;
  }
  return { path: file.filename, line: reviewedLine + offset };
}

function replacementLine(lines: readonly DiffLine[], deletedIndex: number): number | null {
  let start = deletedIndex;
  while (start > 0 && lines[start - 1]?.kind !== "context") start -= 1;
  let end = deletedIndex;
  while (end + 1 < lines.length && lines[end + 1]?.kind !== "context") end += 1;
  const changes = lines.slice(start, end + 1);
  const additions = changes.filter(
    (line): line is DiffLine & { readonly newLine: number } =>
      line.kind === "addition" && line.newLine !== null,
  );
  const deletionCount = changes.filter((line) => line.kind === "deletion").length;
  if (deletionCount !== 1 || additions.length !== 1) return null;
  return additions[0]!.newLine;
}

function locateNewLine(files: readonly DiffFile[], path: string, lineNumber: number): Focus | null {
  const file = files.find((candidate) => candidate.filename === path);
  if (!file) return null;
  for (const hunk of file.hunks) {
    const lineIndex = hunk.lines.findIndex(
      (line) => line.newLine === lineNumber && line.kind !== "deletion",
    );
    if (lineIndex >= 0) return { kind: "diff", file, hunk, lineIndex };
  }
  return null;
}

async function locateSourceLine(
  request: GitHubRequest,
  repository: string,
  ref: string,
  path: string,
  lineNumber: number,
  cache: Map<string, Promise<readonly string[] | null>>,
): Promise<SourceFocus | null> {
  let pending = cache.get(path);
  if (!pending) {
    pending = fetchSource(request, repository, ref, path);
    cache.set(path, pending);
  }
  const lines = await pending;
  const lineIndex = lineNumber - 1;
  return lines && lineIndex >= 0 && lineIndex < lines.length
    ? { kind: "source", path, lines, lineIndex }
    : null;
}

async function fetchSource(
  request: GitHubRequest,
  repository: string,
  ref: string,
  path: string,
): Promise<readonly string[] | null> {
  const [owner, repo] = splitRepository(repository);
  let response: Awaited<ReturnType<GitHubRequest>>;
  try {
    response = await request<unknown>({
      method: "GET",
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}?ref=${encodeURIComponent(ref)}`,
    });
  } catch (error) {
    if (isObject(error) && error.status === 404) return null;
    throw error;
  }
  if (
    !isObject(response.body) ||
    response.body.type !== "file" ||
    response.body.encoding !== "base64" ||
    typeof response.body.content !== "string"
  ) {
    return null;
  }
  const text = Buffer.from(response.body.content.replaceAll("\n", ""), "base64").toString("utf8");
  return text.split("\n");
}

function renderFocuses(focuses: readonly Focus[]): readonly string[] {
  const groups = new Map<string, { focus: Focus; lineIndexes: number[] }>();
  for (const focus of focuses) {
    const key =
      focus.kind === "diff"
        ? `diff\0${focus.file.filename}\0${focus.hunk.header}`
        : `source\0${focus.path}`;
    const group = groups.get(key);
    if (group) group.lineIndexes.push(focus.lineIndex);
    else groups.set(key, { focus, lineIndexes: [focus.lineIndex] });
  }

  const excerpts = [...groups.values()].flatMap(({ focus, lineIndexes }) =>
    mergeWindows(lineIndexes, focusLength(focus)).map(([start, end]) =>
      renderWindow(focus, start, end),
    ),
  );
  return chunkText(excerpts.join("\n\n"), 2_600);
}

function focusLength(focus: Focus): number {
  return focus.kind === "diff" ? focus.hunk.lines.length : focus.lines.length;
}

function mergeWindows(
  lineIndexes: readonly number[],
  lineCount: number,
): readonly (readonly [number, number])[] {
  const windows = [...new Set(lineIndexes)]
    .sort((left, right) => left - right)
    .map((index) => [Math.max(0, index - 3), Math.min(lineCount - 1, index + 3)] as const);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of windows) {
    const last = merged.at(-1);
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function renderWindow(focus: Focus, start: number, end: number): string {
  if (focus.kind === "diff") {
    return `--- ${focus.file.filename}\n${focus.hunk.header}\n${focus.hunk.lines
      .slice(start, end + 1)
      .map(({ raw }) => raw)
      .join("\n")}`;
  }
  const body = focus.lines
    .slice(start, end + 1)
    .map((line) => ` ${line}`)
    .join("\n");
  return `--- ${focus.path}\n@@ lines ${start + 1}-${end + 1} @@\n${body}`;
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

function parsePatch(patch: string): readonly DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = patch.split("\n");
  for (let index = 0; index < lines.length;) {
    const header = lines[index]!;
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
    if (!match) {
      index += 1;
      continue;
    }
    const oldStart = Number(match[1]);
    const oldCount = match[2] === undefined ? 1 : Number(match[2]);
    const newStart = Number(match[3]);
    const newCount = match[4] === undefined ? 1 : Number(match[4]);
    let oldLine = oldStart;
    let newLine = newStart;
    const hunkLines: DiffLine[] = [];
    index += 1;
    while (index < lines.length && !lines[index]!.startsWith("@@ ")) {
      const raw = lines[index]!;
      index += 1;
      if (raw.startsWith("\\ No newline at end of file")) continue;
      if (raw === "") continue;
      if (raw.startsWith("+")) {
        hunkLines.push({ raw, kind: "addition", oldLine: null, newLine });
        newLine += 1;
      } else if (raw.startsWith("-")) {
        hunkLines.push({ raw, kind: "deletion", oldLine, newLine: null });
        oldLine += 1;
      } else {
        hunkLines.push({ raw, kind: "context", oldLine, newLine });
        oldLine += 1;
        newLine += 1;
      }
    }
    hunks.push({ header, oldStart, oldCount, newCount, lines: hunkLines });
  }
  return hunks;
}

function splitRepository(repository: string): readonly [string, string] {
  const [owner, repo, ...rest] = repository.split("/");
  if (!owner || !repo || rest.length > 0)
    throw new Error(`Invalid GitHub repository: ${repository}`);
  return [owner, repo];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
