import { connectSlackCredentials } from "@vercel/connect/eve";
import {
  Actions,
  Button,
  Card,
  slackChannel,
  type SlackChannelState,
  type SlackHandle,
  type SlackThread,
} from "eve/channels/slack";

/** Slack echoes this as action.actionId. Must not start with `eve_input:` (HITL). */
const STOP = "eevee_stop";
/** Key on pendingAuthMessageTs so the button ts survives a workflow step. */
const STOP_TS = "eevee:stop";

export default slackChannel({
  credentials: connectSlackCredentials("slack/eevee"),
  async onMessage(ctx, message) {
    if (message.author?.isBot) return null;

    const isDirectMessage = message.raw.channel_type === "im";
    if (!(isDirectMessage || ctx.isBotMentioned() || (await ctx.isSubscribed()))) {
      return null;
    }

    const text = message.text.trim();
    if (text === "/new") {
      await ctx.reset({ reason: "user /new" });
      await ctx.thread.post("Started a fresh conversation.");
      return null;
    }
    if (text === "/stop") {
      const result = await ctx.cancel();
      await ctx.thread.post(result.status === "accepted" ? "Stopped." : "Nothing is running.");
      return null;
    }

    return { auth: null };
  },
  async onInteraction(action, ctx) {
    if (action.actionId !== STOP) return;
    const result = await ctx.cancel();
    if (action.messageTs) await dropMessage(ctx.slack, action.messageTs);
    if (result.status === "accepted") await ctx.thread.post("Stopped.");
  },
  events: {
    async "turn.started"(_data, channel) {
      channel.state.pendingToolCallMessage = null;
      channel.state.lastReasoningTypingAtMs = null;
      channel.state.lastReasoningTypingStatus = null;
      await channel.thread.startTyping("Working...");
      await postStop(channel);
    },
    "turn.completed": (_data, channel) => dropStop(channel),
    "turn.cancelled": (_data, channel) => dropStop(channel),
    "session.waiting": (_data, channel) => dropStop(channel),
  },
});

type StopChannel = {
  thread: SlackThread;
  slack: SlackHandle;
  state: SlackChannelState;
};

async function postStop(channel: StopChannel) {
  await dropStop(channel);
  const posted = await channel.thread.post(
    Card({
      children: [Actions([Button({ id: STOP, label: "Stop", style: "danger" })])],
    }),
  );
  if (!posted.id) return;
  channel.state.pendingAuthMessageTs = {
    ...channel.state.pendingAuthMessageTs,
    [STOP_TS]: posted.id,
  };
}

async function dropStop(channel: Pick<StopChannel, "slack" | "state">) {
  const bag = channel.state.pendingAuthMessageTs;
  const ts = bag?.[STOP_TS];
  if (ts) await dropMessage(channel.slack, ts);
  if (bag?.[STOP_TS] === undefined) return;
  const next = { ...bag };
  delete next[STOP_TS];
  channel.state.pendingAuthMessageTs = next;
}

async function dropMessage(slack: SlackHandle, ts: string) {
  if (!slack.channelId) return;
  try {
    await slack.request("chat.delete", { channel: slack.channelId, ts });
  } catch {
    // Slack may have already deleted it.
  }
}
