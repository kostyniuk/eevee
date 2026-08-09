import { connectSlackCredentials } from "@vercel/connect/eve";
import { slackChannel } from "eve/channels/slack";

export default slackChannel({
  credentials: connectSlackCredentials("slack/eevee"),
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
