# ReviewRecord database

The app uses Drizzle over ordinary Postgres. Production can run on Supabase;
edge tests run against the real Postgres service in `compose.yaml`.

Criterion details stay in a single `criteria` JSONB document. Postgres CHECK
constraints enforce all six criterion objects, integer ratings from 0 through
5, and string reasoning. Expression indexes on each rating keep criterion-level
feedback and evaluation queries efficient without duplicating the values into
columns.

## Supabase

1. Create a free Supabase project and open **Project Settings → Database →
   Connection string**.
2. Set `DATABASE_URL` to the transaction-pooler connection string. Keep
   `sslmode=require`; the runtime driver disables prepared statements so it is
   compatible with transaction pooling.
3. Set `DATABASE_DIRECT_URL` to the direct connection string (or the session
   pooler when IPv6 is unavailable). This connection is used only by Drizzle
   migrations.
4. Set `SLACK_REVIEW_CHANNEL_ID` to the ID of the notifications channel. The
   Slack connector needs `chat:write` plus the matching history scope
   (`channels:history` for a public channel or `groups:history` for a private
   channel) so an interrupted delivery can be matched by message metadata.
5. Add all three variables to the production environment, then run
   `npm run db:migrate` with those variables available.

Never commit either connection string. `.env.example` contains safe templates.

## Local Postgres

Start the existing service and build a URL from its secret:

```bash
docker compose up -d postgres
export DATABASE_URL="postgresql://eevee:$(cat .secrets/postgres_password)@127.0.0.1:5432/eevee"
export DATABASE_DIRECT_URL="$DATABASE_URL"
npm run db:migrate
```

Generate a new checked-in migration after changing
`agent/lib/review-record-schema.ts`:

```bash
npm run db:generate
```

The ReviewRecord edge eval starts the local database, applies the checked-in
migrations, and builds a temporary fixture agent from `agent/lib`. It
overlays the mock model and fake GitHub and Slack credentials. It drives a
signed GitHub `pull_request.opened` webhook through eve, reads the resulting
row through the DAO, and asserts the immediate Slack Web API call against a
local HTTP stub on port 43120:

```bash
npm run eval:review-records
```

The script builds its connection URL from `.secrets/postgres_password`; values
in `.env.local` cannot redirect the eval to a hosted database.
