# Evals measure review impact, not review text

> SHIPPED. Reviewed and merged code refs produce a blind, shuffled A/B pair at PR close. Votes retain the ReviewRecord link and reveal the identities only after the vote is stored.

An Eval Comparison judges the code before the Review against the code after the author responded (blind, order shuffled), rather than judging two competing reviews of the same diff. We chose this because it costs no extra LLM runs (pairs are harvested from PR history at close), and because "did the code get better?" is the outcome we actually care about. Model-vs-model comparison is deliberately deferred to aggregate statistics over thousands of ReviewRecords (each records its model and instructions version), not pairwise review-text judging.

## Consequences

- A single "B is better" vote entangles review quality with author diligence; the signal is only meaningful in aggregate.
- Reviewer models/instructions can only be compared after rotating them in live use for a while — there is no quick head-to-head.
- The ReviewRecord must capture the reviewed commit and the final merged diff, or pairs cannot be reconstructed later.
