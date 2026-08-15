import { connectSlackCredentials } from "@vercel/connect/eve";
import { slackChannel } from "eve/channels/slack";
import { recordEvalVote } from "../lib/eval-comparison-service";
import { getReviewRecordDao } from "../lib/review-record-dao";

// Slack *chat* channel (DMs / mentions / subscribed threads). This is a
// conversation, not the review-notification hop.
//
// turnPolicy is unset → eve default "steer": a second ACCEPTED @mention
// cancels the in-flight turn and answers the latest message. Returning null
// drops the event first, so it never steers.
export default slackChannel({
  credentials: connectSlackCredentials("slack/eevee"),
  async onInteraction(action, ctx) {
    if (action.actionId !== "eval_vote_a" && action.actionId !== "eval_vote_b") return;
    if (!action.value) return;

    await recordEvalVote({
      actionId: action.actionId,
      pairId: action.value,
      voter: action.user.id,
      dao: getReviewRecordDao(),
      reveal: (message) => ctx.thread.post(message),
    });
  },
  async onMessage(ctx, message) {
    if (message.author?.isBot) return null;

    if (message.text.trim() === "/new") {
      await ctx.reset({ reason: "user /new" });
      await ctx.thread.post("Started a fresh conversation.");
      return null; // STOP — don't send "/new" to the model
    }

    const isDirectMessage = message.raw.channel_type === "im";
    return isDirectMessage || ctx.isBotMentioned() || (await ctx.isSubscribed())
      ? { auth: null }
      : null;
  },
});
