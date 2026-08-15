# Spec: GitHub PR Review Bot

> Interview: this file is the *design*, not the product. Do not describe a bullet as live unless it is in the SHIPPED list.

**SHIPPED:** install via Connect; review on PR `opened` (skip drafts); do not review on push; mention `@eevee-agent` to chat or re-run; advisory `COMMENT` review; safety rating + criteria from instructions; inline findings below threshold; ReviewRecord in Postgres; Slack announcement via claim + metadata hop; close-time GitHub reaction harvest; blind, shuffled before/after Eval Comparisons with Slack voting and post-vote reveal.

**NOT SHIPPED:** sidebar re-request review; Slack re-run button; stale marker on push; coalesce in-flight re-runs; Slack thumbs / thread-reply feedback; live GitHub inline-reply feedback; merge gating.

Status: ready-for-agent
Design session: 2026-08-10. Vocabulary per `CONTEXT.md`; decisions constrained by `docs/adr/0001` (advisory-only Reviews) and `docs/adr/0002` (Evals measure Review impact, not review text).

## Problem Statement

Pull requests get merged with uneven human scrutiny. There is no consistent, always-available first-pass reviewer that tells the team how risky a change is before a human looks at it — and when automated review advice does exist, there is no way to know whether it actually helps, so it cannot be trusted or improved over time.

## Solution

Extend the existing eevee agent with a GitHub presence, installed per-repository the same way it is installed to Slack. When a PR opens (and on manual Re-runs), the agent reviews the full change in its sandbox, grades it against weighted Review Criteria into a Safety Rating (0–5, 5 = safe to merge), and posts a formal, advisory GitHub review — summary always, inline Findings when the rating falls below the threshold. Every Review is announced in a Slack channel with the rating and a link. Humans give Feedback on both surfaces (thumbs and free text), and every Review plus its Feedback is persisted as a ReviewRecord. At PR close, the system harvests GitHub reactions and builds a blind before/after Eval Comparison pair for a dedicated eval channel, so the team accumulates data on whether Reviews actually improve code — the raw material for sharpening Reviewer Instructions and, in aggregate, comparing models.

## User Stories

### Installation & triggering

1. As an engineering lead, I want the agent installed to a GitHub repository the same way it is added to Slack (a guided per-repo install with managed credentials), so that onboarding a repo requires no key management.
2. As an engineering lead, I want only repositories where the agent is installed to be reviewed, so that the bot never touches repos that didn't opt in.
3. As a PR author, I want a Review to run automatically when I open a PR, so that I get a risk signal before any human reviewer arrives.
4. As a PR author, I want draft PRs skipped, so that half-finished work isn't graded.
5. As a PR author, I want pushes to my PR to NOT trigger new Reviews, so that incomplete intermediate states aren't reviewed and noise stays low.
6. As a PR author, I want to trigger a Re-run by mentioning the agent in a PR comment, so that I can get a fresh Review after addressing findings.
7. As a PR author, I want to trigger a Re-run with GitHub's native "re-request review" control next to the bot in the Reviewers sidebar, so that re-running feels like a normal GitHub action.
8. As a teammate triaging in Slack, I want a Re-run button on the Review Notification, so that I can refresh a stale Review without leaving Slack.
9. As a PR author, I want at most one Review running per PR at a time (a Re-run request during a running Review is coalesced), so that duplicate reviews never race each other.

### The Review

10. As a PR author, I want the Review produced with the full repository checked out in the agent's sandbox, so that findings are grounded in real context (callers, siblings, conventions), not just the diff.
11. As an engineering lead, I want the sandbox to be a read-only navigation workspace — no tests, builds, linters, or formatters — so that the agent's job stays distinct from CI's.
12. As a PR author, I want a Safety Rating from 0 to 5 (5 = safe to merge) as the headline of every Review, so that risk is legible at a glance.
13. As an engineering lead, I want the rating computed from named Review Criteria — security, blast radius, correctness, data safety, test coverage, readability — each with an editable priority, so that the score reflects what my team actually cares about.
14. As an engineering lead, I want criteria priorities defined in a Reviewer Instructions document I can edit without touching code, so that retuning the bot is a text change.
15. As an engineering lead, I want optional per-model variants of the Reviewer Instructions with fallback to the general document, so that each model can be prompted to its strengths and instruction experiments are isolated per model.
16. As a PR author, I want the Review posted as a formal GitHub PR review with a summary body (rating, per-criterion reasoning, verdict), so that it appears in the review timeline like any reviewer's work.
17. As a PR author, I want inline Finding comments anchored to the exact lines only when the Safety Rating is below 5, so that only a fully safe Review is summary-only and every lower rating gets precise, actionable annotations.
18. As a PR author, I want the Review to always be advisory ("Comment" type — never "Request changes", never a required check), so that a wrong bot opinion can never block my merge (ADR 0001).
19. As a teammate, I want each Review pinned to the commit it reviewed and superseded (never edited) by newer Reviews, so that the review history is honest and auditable.
20. As a PR author, I want the agent to acknowledge a Re-run request visibly (e.g. a reaction on my triggering comment), so that I know it heard me.

### Slack notifications

21. As a teammate, I want every completed Review announced in one shared Slack channel with the rating, repo/PR link, a one-line verdict, and the top finding when the rating is low, so that I can triage risk without opening GitHub.
22. As a teammate, I want Re-run results posted in the original notification's thread with the top-level message edited to the latest rating, so that one PR occupies one slot in the channel instead of flooding it.
23. As a teammate, I want the notification marked stale ("N newer commits since this Review") when pushes land after the Review, so that I never trust an outdated rating — and the Re-run button is right there when it matters.

### Feedback

24. As a teammate, I want 👍/👎 buttons on the Review Notification, so that rating a Review's usefulness takes one click.
25. As a teammate, I want to write free-text feedback as thread replies on the Review Notification and have it silently captured (a ✅ receipt, never a reply), so that I can explain my verdict without the agent arguing back.
26. As a PR author, I want my 👍/👎 reactions on the GitHub review and its inline comments collected as per-finding Feedback, so that I can grade individual findings where I read them.
27. As a PR author, I want my replies to inline Finding comments captured live as free-text Feedback tied to that Finding, so that my objections and confirmations become training signal.
28. As an engineering lead, I want all Feedback recorded on the ReviewRecord with its source (GitHub vs Slack, who, when), so that the dataset is queryable and attributable.

### ReviewRecords & analysis

29. As an engineering lead, I want every Review persisted as a ReviewRecord — PR reference, reviewed commit, model, instructions version, per-criterion scores, rating, findings, and all Feedback — so that nothing the bot ever said is lost.
30. As an engineering lead, I want the model and instructions version stamped on every ReviewRecord, so that later I can compare models and instruction versions over thousands of live runs by their aggregate outcomes.
31. As an engineering lead, I want to query which finding types and criteria attract negative Feedback, so that I can pinpoint where to change the Reviewer Instructions.
32. As an engineering lead, I want ReviewRecords shaped so any record can later be replayed as an eve eval regression case, so that today's data collection funds tomorrow's automated regression suite.

### Eval Comparisons

33. As an engineering lead, I want a blind before/after pair built automatically when a reviewed PR closes — side A the code as reviewed, side B the code as merged — so that measuring Review impact costs zero extra LLM runs (ADR 0002).
34. As an engineering lead, I want pairs skipped when the code didn't change after the Review, so that judges never see meaningless comparisons.
35. As a judge in the eval channel, I want pairs posted to a dedicated Slack eval channel with A/B vote buttons, order shuffled and identity hidden, so that my vote measures code quality, not deference to the bot.
36. As a judge, I want the before/after identity revealed in the thread after my vote is recorded, so that I get closure without contaminating the vote.
37. As an engineering lead, I want every preference vote recorded with the pair, the voter, and the associated ReviewRecord, so that "did Reviews make code better" is a query, not a feeling.

## Implementation Decisions

- **One agent, extended.** The existing eevee agent gains the GitHub channel; Slack chat behavior is untouched. Reviewer behavior is a channel-scoped branch of the agent's instructions.
- **GitHub integration** uses eve's first-party GitHub channel with Vercel-Connect-managed credentials (`eve add channel/github`, guided setup — no app keys in the repo). The GitHub App must be subscribed to `pull_request`, `issue_comment`, and `pull_request_review_comment` webhook events.
- **Review Triggers** are implemented in the channel's opt-in PR handler: dispatch on `opened` and (as Re-run) on `review_requested` targeting the bot — eve passes through all PR action strings even though only a subset is in the documented type union; the requested reviewer is read from the raw payload. Mention-triggered Re-runs ride the channel's default comment invocation. `synchronize` events are handled without dispatching a turn — they only update the Slack notification's stale marker. Draft PRs are never dispatched.
- **Posting the Review** uses the channel's raw REST escape hatch (installation-token-authenticated request handle) to create a formal PR review with summary body and inline comments — eve does not publicly wrap the reviews API. Review type is always "Comment" (ADR 0001). Finding threshold: rating < 5 → inline comments; ≥ 5 → summary only. Constants live in Reviewer Instructions, not code.
- **Reviewer Instructions** are a general markdown document plus optional per-model variants (keyed by model identifier) resolved with fallback-to-general. They define the six Review Criteria, their priorities, the rating rubric (5 = safe), and the finding threshold. V1 reviewer model: the agent's existing chat model; the model identifier and an instructions version hash are stamped on every ReviewRecord.
- **Sandbox policy**: read-only review — the reviewing turn navigates the checked-out repo (eve checks it out automatically before the first model call) but is instructed and policy-restricted not to execute tests/builds/linters/formatters.
- **Cross-channel delivery**: the GitHub channel persists the ReviewRecord, then calls Slack's Web API directly before its `message.completed` handler returns. The store-backed claim and Slack message metadata preserve idempotency across retries without requiring a recurring schedule. Later stale-marker edits and eval-pair delivery reuse this internal delivery module.
- **Slack surfaces**: one notifications channel (rating, PR link, verdict, top finding, Re-run button; Re-runs post in-thread and the root message is edited to the latest rating + stale markers) and one eval channel (blind A/B pairs). Buttons are Block Kit actions handled by the Slack channel's interaction hook; thread replies on Review Notifications are silently captured as Feedback (✅ reaction receipt) and never dispatched to the model.
- **Feedback capture**: Slack button clicks and thread replies are recorded live. GitHub inline-comment replies are recorded live from `pull_request_review_comment` events. GitHub emoji reactions cannot be received by webhook (platform limitation) — they are harvested once per PR, at close/merge, by polling the reactions API through the channel's REST handle.
- **ReviewRecord DAO** (the one new module boundary): a repository interface over Postgres owned by this app, used by the review turn, the notification service, the interaction handlers, and the harvest job. Conceptual schema — `review_records` (PR ref, repo, reviewed commit SHA, model, instructions version, per-criterion scores, safety rating, findings with file/line anchors, status incl. superseded-by), `feedback` (review record ref, source, kind: vote/text, finding ref nullable, author, body/value, timestamp), `eval_pairs` (review record ref, before diff ref, after diff ref, shuffle order, posted-at), `eval_votes` (pair ref, choice, voter, timestamp). Diffs are stored by reference (repo + SHA range) with enough material to render the pair.
- **PR-close harvest job**: on PR `closed`, one pass performs the reaction harvest and builds the Eval Comparison pair (skipped if the head SHA equals the last-reviewed SHA). Each side contains the mapped hunks for every stored Finding, with overlapping excerpts collapsed; if any Finding cannot be mapped safely from the reviewed SHA to the merged SHA, no partial pair is published. The job then hands the pair to the DAO and notification service.
- **Concurrency**: at most one Review in flight per PR; Re-run requests during a running Review coalesce into one trailing run against the newest head.

## Testing Decisions

- **Philosophy**: test external behavior only — synthetic inputs at the app edge in, observable effects out. No assertions on internal call structure, prompt contents, or intermediate state.
- **One edge seam (existing)**: tests are eve evals driving the system with synthetic GitHub webhook payloads (`pull_request` opened / `review_requested` / draft, `pull_request_review_comment` replies, PR `closed`) and synthetic Slack interaction payloads (button clicks, thread replies). The LLM is replaced with eve's `mockModel()` fixtures so review output (scores, findings) is deterministic per case.
- **Observed effects**: GitHub REST calls (formal review created, inline comments, reactions polled) and Slack Web API calls (notification posted, message edited, pair posted) are stubbed and asserted at the HTTP layer; persistence is asserted as rows in the real local Postgres (existing compose service) through the ReviewRecord DAO.
- **One new tested module boundary**: the ReviewRecord DAO — exercised through the edge tests; its interface is also the assertion surface for persistence.
- **Prior art**: none in this repo yet (first tests); the pattern follows eve's documented evals harness (eval files, mock models, assertions/gates), which is the framework-native equivalent of integration tests.
- **Key scenarios**: PR opened → review posted + notification + record; rating below threshold → inline comments present; draft → no dispatch; push → stale marker only, no review; each Re-run path (mention, re-request, Slack button) → superseding review; thread reply → silent feedback capture + receipt; inline reply → per-finding feedback; PR close → reactions harvested + blind pair posted (and skipped when unchanged); A/B vote → preference row + identity reveal; concurrent Re-run requests → single trailing review.

## Out of Scope

- Merge gating of any kind — required checks, "Request changes" reviews, commit statuses (deferred until Feedback data justifies it; ADR 0001).
- Running tests, builds, linters, formatters, or dependency audits in the sandbox — CI's job.
- Per-push automatic re-reviews and debounce machinery for them.
- Per-repo configuration overrides of criteria/threshold (central policy only for v1).
- Shadow/parallel multi-model reviews and pairwise review-text judging (model comparison is aggregate statistics over live records; ADR 0002).
- Auto-generating eve eval regression cases from ReviewRecords (records are shaped for it; wiring is v2).
- A web UI for judging or analytics; daily mid-PR reaction sweeps; a separate reviewer agent/deployment.
- GitLab or any non-GitHub forge.

## Further Notes

- Two platform constraints shaped the design and are worth re-verifying if eve or GitHub change: GitHub delivers no webhook for emoji reactions (hence the close-time harvest), and eve forbids cross-channel sends from inside a channel turn (hence the delivery hop).
- The "re-request review" trigger relies on eve's PR-action passthrough of undocumented action strings; if a future eve version narrows this, the mention trigger remains the fallback.
- The eval channel's judgment quality depends on keeping pairs blind — any future rendering change must preserve shuffled, unlabeled sides with post-vote reveal.
- Success metric to watch once live: the rate at which judges pick the "after" side in Eval Comparisons, segmented by model and instructions version.
