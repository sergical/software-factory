# software-factory

Demo for the agent tracing and cost talk. Two workspaces:

- `apps/factory`: Vercel's eve software-factory template ("Foreman") with Sentry tracing added in `agent/instrumentation.ts`.
- `apps/web`: a small Vite + React todo app with seeded defects. The factory fixes them from GitHub issues. See `apps/web/ISSUES.md`.

## Local checks (no credentials)

```sh
pnpm install
pnpm -r typecheck
pnpm --filter @software-factory/web test   # `generates unique ids` is flaky on purpose
pnpm --filter @software-factory/web lint
```

## Accounts and keys

1. Vercel account with AI Gateway enabled. The factory reads model credentials through Vercel Connect, so no gateway key goes in `.env`.
2. Vercel project for `apps/factory` with Blob and Sandbox enabled.
3. Vercel Connect GitHub connector with write access to the target repository (contents, issues, pull requests).
4. Sentry project (Node.js platform). Copy its DSN.
5. Optional: Vercel Connect Linear connector.

## Runbook

Steps marked "interactive" open a browser or prompt; run them yourself.

1. Push `apps/web` to a new GitHub repository. Its `owner/repo` is `FACTORY_REPO`.
   ```sh
   cd apps/web && git init && git add . && git commit -m "Seed todo app"
   gh repo create <owner>/software-factory-web --private --source . --push   # interactive
   ```
2. Link the factory to Vercel.
   ```sh
   cd apps/factory
   vercel login                       # interactive
   vercel link                        # interactive: create a new project
   ```
3. Create the connectors and install the GitHub App on the `apps/web` repository.
   ```sh
   vercel connect create github       # interactive; note the UID
   vercel connect create linear       # optional
   ```
4. Create the Blob store from the Vercel dashboard (Storage > Create > Blob) and connect it to the project. Interactive.
5. Write `apps/factory/.env` from `.env.example`:
   - `GITHUB_CONNECTOR`, `LINEAR_CONNECTOR`: the connector UIDs.
   - `FACTORY_REPO`: `<owner>/software-factory-web`.
   - `FACTORY_SETUP_COMMAND="pnpm install"`.
   - `SENTRY_DSN`: from the Sentry project.
6. Run the factory locally in a separate terminal (do not background it).
   ```sh
   cd apps/factory && pnpm dev        # eve dev; interactive first run
   ```
   Or deploy: `vercel env pull`, then `vercel deploy`.
7. File the issues from `apps/web/ISSUES.md` on the web repository and add the `factory` label to each. One issue at a time gives the cleanest traces.
   ```sh
   gh issue create --repo <owner>/software-factory-web --label factory --title "..." --body "..."
   ```
8. Open Sentry > Insights > AI Agents. Each labelled issue is one trace: the orchestrator turn, then `classifier`, `analyst`, `implementer`, and `reviewer` turns, each with `gen_ai.*` model spans and `execute_tool` spans. The issue number is `ai.settings.context.factory.issue_number` on the `agent.step` spans (Sentry strips it from the mapped `gen_ai` spans).

## Instrumentation

`apps/factory/agent/instrumentation.ts` is eve's single-file instrumentation
layout. Its `setup` runs `Sentry.init` with `vercelAIIntegration({ force: true })`.
Sentry owns the OpenTelemetry provider; eve emits its `agent.*` spans and the
AI SDK spans through the same global provider, so all of them reach Sentry.
Unset `SENTRY_DSN` disables it.
