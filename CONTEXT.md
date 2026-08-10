# eevee

An eve-framework agent that chats on Slack and reviews GitHub pull requests, rating how safe each one is to merge and learning from human feedback on its reviews.

## Language

### Reviewing

**Pull Request (PR)**:
A GitHub pull request — the unit of change the agent reviews.
_Avoid_: merge request, MR

**Review**:
One automated, advisory pass over a PR's changes at a specific commit, posted to GitHub as a formal PR review. A newer Review supersedes an older one; Reviews are never edited and never block a merge.

**Safety Rating**:
A Review's headline number from 0 to 5, where 5 means safe to merge. A weighted composite of the Review Criteria, not a single dimension.
_Avoid_: score, grade

**Review Criteria**:
The named dimensions a Review grades — security, blast radius, correctness, data safety, test coverage, readability — each carrying a human-editable priority that sets its weight in the Safety Rating.

**Finding**:
One specific issue a Review raises, anchored to a file and lines. Findings appear as inline comments when the Safety Rating falls below the finding threshold.

**Reviewer Instructions**:
The instruction set that drives a Review: one central general document, optionally overridden by a per-model variant; the general document applies when no variant exists for the active model.

**Review Trigger**:
What starts a Review: automatically when a PR opens, or manually afterward — never on a push by itself.

**Re-run**:
A manual request for a fresh Review of the PR's current state, invoked by mentioning the agent on the PR, re-requesting its review on GitHub, or pressing the button on the Review Notification.

### Feedback & evals

**Review Notification**:
The Slack message announcing a completed Review: rating, PR link, verdict. Marked stale when the PR gains commits the Review hasn't seen, and superseded in-thread by Re-run results.

**Feedback**:
A human verdict on a single live Review's usefulness — thumbs and free-text replies given on the Review Notification or on the GitHub review itself. The agent never argues with Feedback.
_Avoid_: eval, poll

**ReviewRecord**:
The persisted record of one Review — what was reviewed, by which model under which instructions, what it concluded, and all Feedback it received. The raw material for improving Reviewer Instructions and, in aggregate, comparing models.

**Eval Comparison**:
A blind before/after judgment of a Review's impact: side A is the PR's code as reviewed, side B is the code as merged after the author responded; a human picks the better code without knowing which side is which. Measures whether Reviews lead to better code — not which model writes prettier review text.
_Avoid_: A/B model test, poll
