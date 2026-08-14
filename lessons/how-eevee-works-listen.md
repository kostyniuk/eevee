How eevee works. A listen-through for tomorrow.

Speak this at a normal pace. It should land around fifteen minutes. If your voice app has a pause between paragraphs, leave that on. This is written to be heard, not skimmed.

---

Hi. This is how eevee works. Not the framework tour. The system I actually shipped, with the Slack path in detail, because that is the part I need in my mouth, not just in the docs.

Start with the product, in two sentences.

Pull requests get uneven human scrutiny. I wanted a first-pass reviewer that is always there, tells you how safe a change looks, and never blocks the merge. A bot that can veto you gets turned off before it can earn trust. So every review is advisory. GitHub type Comment. Never request changes. Never a required check. That is a decision, not a missing feature.

The headline of every review is a safety rating from zero to five. Five means safe to merge. It is a weighted mix of six criteria. Security, blast radius, correctness, data safety, test coverage, and readability. The weights live in a markdown instruction document, not in code. If the rating is below three, the review also drops inline findings on the changed lines. At three or above, summary only. Clean pull requests stay quiet.

That is the product. Now the path.

Someone opens a pull request. GitHub fires a webhook. Eve verifies it and asks my GitHub channel: do you want a turn?

This is admission. I return an object, or I return null. Null means drop it. No session work. No cancel. No steer. Drafts return null. Pushes return null. The action name for a push is synchronize. I only auto-start a review when the action is opened, and it is not a draft.

So if they push three more commits while I am reviewing, those webhooks hit the handler and die at the door. The in-flight review is not cancelled. It is still reviewing the commit it checked out. I do not silently switch to the latest push. I also do not yet mark the Slack message stale. That is in the spec. It is not shipped. If they ask, I say that.

A re-run today is a mention. Someone writes at eevee-agent on the pull request. If they ask for a new review, the model returns the review JSON again. If they just ask a question, it answers in prose. Discussion from other people is wrapped as untrusted quoted evidence. It may inform the review. It must not override the instructions or invent findings. Ratings come from the code.

Eve then runs a turn. I need three words, and I need them clean.

A session is the durable conversation. On GitHub, that is this pull request thread. On Slack, that is a thread or a DM. Same agent, different front door.

A turn is one inbound message and all the work it causes, until there is a reply.

A step is one model hop plus the tool calls from that hop. That is the checkpoint.

Eve runs the turn as a durable workflow. Locally the workflow state lives on disk. On Vercel it is Vercel Workflow. If a step finishes, and the next one dies, the finished step is not re-run. Eve replays its recorded output. If a step is interrupted mid-flight, that step re-runs, including the model call. Prior steps do not.

That is why my side effects matter. Durability does not make them safe. It tells me which ones must be idempotent.

Before the first model call, eve checks out the pull request into the sandbox. Read only. The model may read files, glob, and grep. It must not bash, write, test, build, or lint. Reviewing is not C I. The installation token never enters the sandbox.

The model returns JSON. Safety rating, summary, verdict, six criteria, findings. I parse and validate that. I ignore message-completed events whose finish reason is tool-calls, because the model often narrates before it calls tools. Only the final assistant text is a review. If it is not a review, I just post a comment on the thread.

If it is a review, I do three writes, in this order. Remember the order. They will ask.

First, I post a formal GitHub review through the installation token. Type Comment. Body is the formatted rating. Commit id is the head S H A. Inline comments only if the rating is below the threshold. This post has no idempotency key. If this handler runs again after GitHub already accepted the review, GitHub gets a second formal review. That is the hole. I say it before they find it.

Second, I insert a ReviewRecord in Postgres. The key is the source turn identifier. Session id, colon, turn id. Same turn, same key, I return the existing row. There is a unique index. The pre-check sits outside the transaction. If two retries race, the index is the real guard. The row stores the repo, the pull number, the commit, the model, the instructions version, the criteria, the rating, the findings. If that pull already had an active review, the new row supersedes the old one. One active review per pull request.

Third, Slack.

This is the part to know cold.

I do not start a Slack session. I do not call to-slack-send. That function starts a Slack turn. The string you pass is model input, like a user message. Then the agent runs and posts its reply into Slack. A notification is not a conversation. I want one message in a channel. So I call Slack's web A P I myself. Chat post message. That is the delivery hop.

Why a hop at all? Slack and Postgres cannot commit together. There is no two-phase commit. The process can die after Slack says okay and before I write that down. If I naively retry, I post twice. The invariant is: at most one Slack message per ReviewRecord.

The row has a notification status. Pending. Delivering. Delivered. A check constraint makes illegal combinations refuse to write. You cannot be delivered without a Slack timestamp. You cannot be pending with a claim time already set.

When I deliver, I claim. Inside a transaction I pick pending rows, or delivering rows whose lease is older than five minutes. I lock them with for-update skip-locked, so two workers cannot grab the same row. A first claim moves pending to delivering, and stamps attempted-at and claimed-at. A retry leaves it delivering and only refreshes claimed-at. The worker is told whether this is a retry.

First attempt. I do not read history. I post. The Slack message carries hidden metadata. Event type, review notification. Payload, the ReviewRecord id. Then I mark delivered, but only if the row is still delivering and claimed-at still matches my claim. If another worker took the lease, mark fails, and I throw. I do not invent success.

If Slack itself fails, I release the row back to pending, only if I still own the claim, and I throw.

Retry. This is the whole point. Slack already posted. Postgres never heard. The lease expires, or a later review's delivery pass claims the stuck row. Retry is true. I do not post first. I ask Slack for channel history, starting one minute before the original attempt. I look for a message whose metadata has this review record id. If I find it, I take its timestamp and only stamp delivered. I do not post. If I do not find it, then I post, then I stamp.

The eval that matters says: retry after Slack success and database failure does not post twice. One post. One history read. One Slack message.

Say this in the room: Slack is not idempotent because I fetch all messages and send the missing ones. Slack is idempotent because each ReviewRecord has one id, I stamp that id on the Slack message, and a retry looks that id up before it posts.

What appears in Slack? Safety rating, a link to the pull request, the summary, the verdict. If the rating is below the threshold, the top finding as well.

One more Slack fact, because they will mix the two Slack surfaces.

People can also talk to the agent in Slack as a chatbot. DMs, mentions, subscribed threads. That is a normal eve channel. Slash new resets the session and does not send slash-new to the model. That path is a conversation. The review notification path is not. Do not describe them as the same thing.

Steer versus queue, because this will come up.

Eve's default turn policy is steer. It only applies to accepted messages. Admission runs first.

A push is not accepted. Steer does not run. In-flight review continues.

Two accepted Slack mentions in a row, while a turn is still running. Steer buffers the second, cancels the first, starts a new turn for the latest message. You get one reply, for the latest. Anything the first turn already posted stays. It is not rolled back. If I set queue, the first turn would finish, then the second would run, and you would get both replies. I did not set queue. So Slack chat is steer.

Same rule on GitHub. A second accepted mention while a review turn is running cancels that turn and starts another. Completed side effects stay. If the first turn already posted a GitHub review, that review is still there. The spec wanted in-flight re-runs to coalesce into one trailing review of the newest head. That is not shipped.

Crash versus throw. Keep them apart.

If the process dies mid-step, eve re-runs that step. New event ids. The ReviewRecord insert is safe under the same turn id. Slack is safe under the claim and the metadata. The GitHub review post is not safe.

If my channel handler throws, the event is already durable, and the turn becomes turn-failed. Eve does not retry that turn. A hook throw is the same idea. If I already inserted the ReviewRecord, and Slack then threw, the row is still pending or delivering. Eve will not come back on its own. The next successful review that runs the delivery hop can flush stuck rows. There is no schedule doing that today.

Why is this publisher on the GitHub channel, and not a hook?

A hook in the hooks folder runs on the runtime stream for every channel. Fine for audit. Wrong place to post a GitHub review, unless I re-check is-this-a-review-turn anyway. A channel adapter event is for this surface. The formal review is GitHub-shaped. Installation token, Comment, commit S H A, inline comments. It belongs on GitHub's message-completed.

What I have not shipped, said out loud so I do not lie.

No stale marker when they push after a review. No Slack re-run button. No thumbs on the Slack message. No harvesting GitHub reactions at close. No blind before-and-after eval pairs in an eval channel. No merge gating. The records are shaped for those later. The loop is not live yet. There is no production incident and no real-team review to point at. If they ask what I would do next week, I say: run it on real pull requests, capture feedback, harvest the first eval pairs, and see whether judges pick the after side.

The talk, if they let me start.

I do not teach eve. I say: I specified and built a review agent that has to earn trust. Advisory on purpose. Auto on open. Never on push. Persist every review. Announce it in Slack once, even if the process dies after Slack accepts. Eve is one slide. Session, turn, step. Crash resumes from the last finished step, so my side effects must be idempotent. Two of them are. The GitHub post is not. Then I shut up and let them grill.

If they already know eve, they will drag me into durability. I am ready. If they do not, they still understood a product.

That is the system. Listen once more to the Slack invariant, and stop.

Slack and Postgres cannot commit together. I claim a row. I post with the row id in Slack metadata. On retry I look that id up. I never post twice for the same review. That is the hop. That is the interesting architecture.
