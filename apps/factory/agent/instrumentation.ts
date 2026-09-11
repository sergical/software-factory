import { init, setTags, vercelAIIntegration } from "@sentry/node";
import { defineInstrumentation } from "eve/instrumentation";
import { intakeIssueNumber } from "./lib/trust.js";

/**
 * Sends every eve trace to Sentry.
 *
 * @remarks
 * eve's single-file instrumentation layout leaves OpenTelemetry provider
 * registration to `setup`, so `Sentry.init` owns the tracer provider, context
 * manager, and propagator. eve creates its `agent.*` spans and the AI SDK's
 * `ai.*` spans through its bundled `@opentelemetry/api`, which resolves the
 * same global provider, so all of them reach Sentry's span processor. The
 * Vercel AI integration then maps the AI SDK spans to `gen_ai.*` for Sentry's
 * AI Agents view. `force` is required: the `ai` module is loaded before
 * `setup` runs, so Sentry cannot detect it through module patching, and eve
 * already enables the AI SDK's telemetry itself.
 *
 * `step.started` stamps the intake issue number into the runtime context.
 * eve flattens it to `ai.settings.context.factory.issue_number` on the step
 * span and the AI SDK spans under it, so one GitHub issue can be found across
 * every station of a run.
 */
export default defineInstrumentation({
  events: {
    "step.started": ({ session }) => {
      const issue =
        intakeIssueNumber(session.auth.current) ??
        intakeIssueNumber(session.auth.initiator);
      return {
        runtimeContext: {
          factory: {
            issue_number: issue,
            root_session_id: session.parent?.rootSessionId ?? session.id,
          },
        },
      };
    },
  },
  recordInputs: true,
  recordOutputs: true,
  setup: ({ agentName, frameworkVersion }) => {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) {
      return;
    }
    init({
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
      tracesSampleRate: 1,
    });
    setTags({
      "agent.name": agentName,
      "eve.version": frameworkVersion ?? "unknown",
    });
  },
});
