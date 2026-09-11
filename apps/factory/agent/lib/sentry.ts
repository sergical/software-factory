import type { NodeClient } from "@sentry/node";
import { getClient, init, vercelAIIntegration } from "@sentry/node";

/**
 * Starts the Sentry SDK once per process and returns its client, or
 * `undefined` when `SENTRY_DSN` is unset.
 *
 * @remarks
 * Both instrumentation providers call this, so whichever eve loads first
 * starts the SDK; the span processor needs the client at construction time.
 * `skipOpenTelemetrySetup` keeps `init` off the OpenTelemetry globals, which
 * eve owns. `force` on the Vercel AI integration is required because eve
 * enables AI SDK telemetry itself and loads `ai` before this runs, so Sentry
 * cannot detect the module through patching.
 */
export function sentryClient(): NodeClient | undefined {
  const existing = getClient<NodeClient>();
  if (existing) {
    return existing;
  }
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return;
  }
  return init({
    dsn,
    environment: process.env.VERCEL_ENV ?? "development",
    integrations: [
      vercelAIIntegration({
        force: true,
        recordInputs: true,
        recordOutputs: true,
      }),
    ],
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    sendDefaultPii: true,
    skipOpenTelemetrySetup: true,
    tracesSampleRate: 1,
  });
}
