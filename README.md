# software-factory

Demo for the agent tracing and cost talk. Two workspaces:

- `apps/factory`: Vercel's eve software-factory template ("Foreman") with Sentry tracing added in `agent/instrumentation/`. See `apps/factory/INSTRUMENTATION.md`.
- `apps/web`: a small Vite + React todo app with seeded defects. The factory fixes them from GitHub issues. See `apps/web/ISSUES.md`.

The factory operates on its own repository: `FACTORY_REPO` is `sergical/software-factory`, the target app is `apps/web`, and `FACTORY_SETUP_COMMAND` is `pnpm install` at the repository root.

## Local checks (no credentials)

```sh
pnpm install
pnpm -r typecheck
pnpm --filter @software-factory/web test   # `generates unique ids` is flaky on purpose
pnpm --filter @software-factory/web lint
```

## Accounts

Done:

- GitHub repository `sergical/software-factory` (public) with the `factory` label and issues #1 to #6 from `apps/web/ISSUES.md`.
- Vercel project `software-factory` on the `sentry` team, linked from `apps/factory`, with Blob store `software-factory-brain` connected.
- Sentry project `software-factory` in `sentry-developer-experience`, DSN in `apps/factory/.env` (gitignored).
- Vercel env vars `FACTORY_REPO`, `FACTORY_SETUP_COMMAND`, `FACTORY_LABEL`, `BLOB_READ_WRITE_TOKEN`.

## Runbook

Steps marked "interactive" open a browser; run them yourself.

1. Create the Vercel Connect GitHub connector and install the GitHub App on `sergical/software-factory` (contents, issues, pull requests).
   ```sh
   cd apps/factory
   vercel connect create github --name foreman-agent --triggers --scope sentry   # interactive
   ```
   Put the UID in `apps/factory/.env` as `GITHUB_CONNECTOR`, then
   `vercel env add GITHUB_CONNECTOR production --scope sentry`.
2. Add the secrets to the Vercel project (once):
   ```sh
   vercel env add SENTRY_DSN production --sensitive --scope sentry
   vercel env add AI_GATEWAY_API_KEY production --sensitive --scope sentry
   ```
3. Run the factory in a separate terminal (do not background it), or deploy.
   ```sh
   cd apps/factory && pnpm dev        # eve dev
   vercel deploy --scope sentry       # or
   ```
4. Add the `factory` label to one issue at a time; that gives the cleanest traces.
5. Open Sentry > Insights > AI Agents. Each labelled issue is one trace: the Foreman turn, then `classifier`, `analyst`, `implementer`, and `reviewer` turns with `gen_ai.*` model spans and `execute_tool` spans. Filter by `factory.issue_number`.

## Instrumentation

`apps/factory/agent/instrumentation/sentry.ts` starts the Sentry SDK and
`sentry-spans.ts` hands Sentry's span processor to eve's OpenTelemetry
pipeline. Unset `SENTRY_DSN` disables it. Details and the discrepancies with
Sentry's docs are in `apps/factory/INSTRUMENTATION.md`.
