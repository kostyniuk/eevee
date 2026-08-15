---
description: Always load and follow this procedure before producing a formal pull request Review.
---

# Two-axis code review

Review the supplied pull request diff against its fixed base/head comparison
along two independent axes:

- **Standards** — does the change follow this repository's documented coding
  standards and avoid materially worsening established code smells?
- **Spec** — does the change faithfully implement the originating issue or
  specification?

Do not stop after the first plausible problem. Run both axes in parallel so
their contexts and conclusions stay independent, then aggregate all supported
evidence into the required Review JSON.

## 1. Pin the review scope

Treat the pull request's supplied base/head comparison as fixed and review only
that change. Inventory all changed files and hunks before judging individual
lines. Use repository files and the supplied PR context as evidence; do not use
the network or modify or execute the code.

## 2. Identify the spec source

Look for the originating requirement in this order:

1. Issue references in the supplied PR or commit context.
2. A spec path supplied in the context.
3. A matching file under `docs/`, `specs/`, or `.scratch/`.

If no spec is available, the Spec reviewer must report that instead of
inventing requirements.

## 3. Identify the standards sources

Read applicable repository guidance such as `AGENTS.md`, `CONTRIBUTING.md`,
`CONTEXT.md`, architecture decisions, and conventions in nearby code. A
documented repository rule overrides the generic smell baseline below. Skip
formatting or style that tooling already enforces.

Always apply this Fowler-inspired smell baseline as judgment-call heuristics,
never as automatic hard violations:

- **Mysterious Name** — a function, variable, type, or database object whose
  name no longer reveals what it does or holds. Rename it; if no honest name
  exists, the design may be unclear.
- **Duplicated Code** — the same logic shape appears more than once. Extract the
  shared shape. A new third copy is introduced duplication even when the first
  two predate the pull request.
- **Feature Envy** — code reaches through another module's data more than its
  own. Move behavior toward the data it uses.
- **Data Clumps** — the same fields or parameters repeatedly travel together.
  Introduce the domain type they imply.
- **Primitive Obsession** — a primitive or string stands in for a domain
  concept. Give the concept a constrained type.
- **Repeated Switches** — the same switch or conditional cascade on one kind
  recurs. Centralize the dispatch.
- **Shotgun Surgery** — one logical change requires scattered edits. Gather the
  concept behind a deeper interface.
- **Divergent Change** — one module has several unrelated reasons to change.
  Split responsibilities at a coherent boundary.
- **Speculative Generality** — abstractions, parameters, or hooks serve no
  current requirement. Remove them until a real need exists.
- **Message Chains** — callers navigate a deep object structure. Hide the walk
  behind a method at the owning boundary.
- **Middle Man** — a layer mostly delegates without adding policy or hiding
  complexity. Call the real owner directly.
- **Refused Bequest** — an implementation ignores most of an inherited
  contract. Prefer a smaller interface or composition.

Also inspect changed code for concrete engineering hazards: swallowed failures,
hardcoded credentials, injection, unsafe regular expressions, hidden input
mutation, unjustified `any`, async Promise executors, unbounded shared state,
needless sequential I/O, races, and non-idempotent retry paths.

## 4. Delegate both axes in parallel

Call the `agent` tool twice in the same response. Give each child the fixed
base/head scope, complete changed-file inventory and relevant diff evidence,
commit context, and the source paths or contents it needs. Children share the
read-only workspace but do not see the parent's conversation.

### Standards child brief

Ask it to inspect every changed file and relevant nearby code, then report under
400 words:

1. Every documented-standard violation, citing the source rule and changed
   line.
2. Every materially introduced or worsened baseline smell, labelled as a
   judgment call with the changed hunk.
3. Every concrete engineering hazard, with its failure or maintenance cost and
   a proportionate fix.

Optional refactors and pre-existing smells that the change does not worsen are
not Findings.

### Spec child brief

Give it the originating spec evidence and ask it to trace every requirement and
acceptance criterion to code and tests, then report under 400 words:

1. Requirements that are missing or only partially implemented.
2. Behavior not requested by the spec, including unrelated skipped tests or
   scope changes.
3. Requirements that appear implemented but behave incorrectly.

It must quote or precisely cite the requirement for every concern. It must look
for extra gates that silently narrow required behavior and implementations that
satisfy literal wording while defeating user-visible intent. A status label or
documentation claim is not proof of correctness.

For workflows, it must trace failures, retries, ordering changes, and multiple
actors. Ask what the second user sees after the first acts, whether public output
leaks state intended to remain private, whether identity or position can be
misattributed, and whether partial success can duplicate or corrupt durable
data. Inspect callers and consumers rather than a helper in isolation.

## 5. Aggregate and sweep

Keep Standards and Spec evidence conceptually separate while translating it to
the required criteria and Findings. Passing one axis must not excuse a failure
on the other, and one strong Finding must not suppress other independent
Findings.

Sweep every changed file and all six Review Criteria once more. For each
concern, require changed-line evidence, a concrete failure or maintenance cost,
and a proportionate fix. Remove speculative, duplicate, and preference-only
concerns. Preserve every distinct supported issue, then order final Findings by
seriousness as required by the Reviewer Instructions.
