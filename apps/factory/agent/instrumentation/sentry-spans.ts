import { SentrySpanProcessor } from "@sentry/opentelemetry";
import type { InstrumentationRuntimeContextInput } from "eve/instrumentation";
import { otelIntegration, type SpanProcessor } from "eve/instrumentation/otel";
import { sentryClient } from "../lib/sentry.js";
import { intakeIssueNumber } from "../lib/trust.js";

const RUNTIME_CONTEXT_PREFIX = "ai.settings.context.";

interface StartedSpan {
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly setAttribute: (key: string, value: string | number) => unknown;
}

/**
 * Reshapes eve's spans into what Sentry's AI Agents view reads.
 *
 * @remarks
 * Sentry places a span by `sentry.op`; eve's own `invoke_agent` and
 * `execute_tool` spans carry the GenAI semantic `gen_ai.operation.name`
 * instead, so this copies it into `gen_ai.<operation>`. Sentry's Vercel AI
 * mapping also drops the AI SDK's `ai.settings.*` attributes, which is where
 * eve flattens the runtime context, so the `factory.*` values are copied to
 * top-level attributes before that mapping runs.
 */
const sentryAttributes: SpanProcessor = {
  forceFlush: () => Promise.resolve(),
  onEnd: () => undefined,
  onStart: (started) => {
    const span = started as StartedSpan;
    const operation = span.attributes["gen_ai.operation.name"];
    if (typeof operation === "string" && !span.attributes["sentry.op"]) {
      span.setAttribute("sentry.op", `gen_ai.${operation}`);
    }
    for (const [key, value] of Object.entries(span.attributes)) {
      if (
        key.startsWith(RUNTIME_CONTEXT_PREFIX) &&
        (typeof value === "string" || typeof value === "number")
      ) {
        span.setAttribute(key.slice(RUNTIME_CONTEXT_PREFIX.length), value);
      }
    }
  },
  shutdown: () => Promise.resolve(),
};

function station({ channel }: InstrumentationRuntimeContextInput): string {
  if (channel.kind !== "subagent") {
    return "foreman";
  }
  const { name } = channel.metadata;
  return typeof name === "string" ? name : "subagent";
}

const client = sentryClient();

/**
 * Routes eve's OpenTelemetry pipeline into Sentry and stamps the intake
 * issue on every model-call span.
 *
 * @remarks
 * eve flattens the returned runtime context to
 * `ai.settings.context.factory.*` on the AI SDK spans, so one GitHub issue
 * can be found across every station of a run.
 */
export default otelIntegration({
  recordInputs: true,
  recordOutputs: true,
  runtimeContext: (input) => {
    const { session } = input;
    return {
      factory: {
        issue_number:
          intakeIssueNumber(session.auth.current) ??
          intakeIssueNumber(session.auth.initiator),
        root_session_id: session.parent?.rootSessionId ?? session.id,
        station: station(input),
      },
    };
  },
  spanProcessors: client
    ? [sentryAttributes, new SentrySpanProcessor({ client })]
    : [],
});
