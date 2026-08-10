import { defaultEveAuth, eveChannel } from "eve/channels/eve";
import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";

export default eveChannel({
  auth: [
    // Lets the eve TUI and your Vercel deployments reach the deployed agent.
    vercelOidc(),
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // This placeholder will not allow browser requests in production.
    // Replace it with your app's auth provider, like Auth.js or Clerk,
    // or use none() for a public demo.
    placeholderAuth(),
  ],
  onMessage(ctx, message) {
    console.error("[eve] onMessage", {
      sessionId: ctx.eve.sessionId,
      caller: ctx.eve.caller?.principalId ?? "anonymous",
      preview: typeof message === "string" ? message.slice(0, 80) : "[parts]",
    });
    return { auth: defaultEveAuth(ctx) };
  },
  events: {
    "turn.started"(data, _ch, ctx) {
      console.error("[eve] turn.started", ctx.session.id, data);
    },
    "message.completed"(data, _ch, ctx) {
      console.error("[eve] message.completed", ctx.session.id, data);
    },
    "turn.failed"(data, _ch, ctx) {
      console.error("[eve] turn.failed", ctx.session.id, data);
    },
  },
});
