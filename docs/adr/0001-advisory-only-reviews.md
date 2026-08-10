# Reviews are advisory-only

The PR review agent posts formal GitHub reviews of type "Comment" and never requests changes, sets commit statuses, or otherwise gates merging — even when the Safety Rating is 0. An LLM reviewer that blocks merges gets disabled by annoyed humans before it can earn trust; instead, trust is built through the Feedback and Eval Comparison loop, and merge-gating (via a commit status/check, not review semantics) may be added later once the collected data shows the ratings are reliable.

## Considered Options

- Request-changes reviews or a required check from day one — rejected: socially irreversible if the bot is wrong early.
- Advisory forever — left open; this ADR only defers gating, it does not rule it out.
