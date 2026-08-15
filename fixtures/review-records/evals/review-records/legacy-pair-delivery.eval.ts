import { defineEval } from "eve/evals";
import { equals, includes } from "eve/evals/expect";

import { deliverEvalPair } from "#lib/eval-comparison-service";
import type { EvalPair } from "#lib/review-record-dao";

export default defineEval({
  description: "A legacy Eval Pair without evidence releases its delivery claim.",
  async test(t) {
    const claimedAt = new Date();
    const pair = legacyPair(claimedAt);
    let released = false;
    let posts = 0;
    let failure = "";

    const dao = {
      async claimEvalPairDelivery() {
        return { pair, attempt: "first" as const };
      },
      async releaseEvalPairDelivery(id: string, at: Date) {
        released = id === pair.id && at === claimedAt;
      },
      async getEvalPair() {
        return pair;
      },
      async markEvalPairDelivered() {
        return false;
      },
    };

    try {
      await deliverEvalPair({
        pair,
        channelId: "C_EVAL_FIXTURE",
        dao,
        slack: {
          async findPosted() {
            return null;
          },
          async post() {
            posts += 1;
            return { ok: true, channel: "C_EVAL_FIXTURE", ts: "unexpected" };
          },
        },
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    t.check(failure, includes("run the evidence backfill first"));
    t.check(released, equals(true));
    t.check(posts, equals(0));
  },
});

function legacyPair(claimedAt: Date): EvalPair {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    reviewRecordId: "00000000-0000-4000-8000-000000000002",
    beforeDiff: {
      repository: "kostyniuk/fixture",
      baseSha: "1".repeat(40),
      headSha: "2".repeat(40),
    },
    afterDiff: {
      repository: "kostyniuk/fixture",
      baseSha: "1".repeat(40),
      headSha: "3".repeat(40),
    },
    evidence: null,
    shuffleOrder: "before_first",
    deliveryStatus: "delivering",
    deliveryAttemptedAt: claimedAt,
    deliveryClaimedAt: claimedAt,
    postedAt: null,
    slackChannelId: null,
    slackMessageTs: null,
    createdAt: claimedAt,
  };
}
