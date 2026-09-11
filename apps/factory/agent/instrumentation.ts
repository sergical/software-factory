import { createHash } from "node:crypto";
import {
  consoleLoggingIntegration,
  getCurrentScope,
  httpIntegration,
  init,
  setConversationId,
} from "@sentry/node";
import {
  defineInstrumentation,
  type InstrumentationRuntimeContextInput,
} from "eve/instrumentation";
import { intakeIssueNumber } from "./lib/trust.js";

function station({ channel }: InstrumentationRuntimeContextInput): string {
  if (channel.kind !== "subagent") {
    return "foreman";
  }
  const { name } = channel.metadata;
  return typeof name === "string" ? name : "subagent";
}

/**
 * Sends the factory's traces, logs, metrics and errors to Sentry.
 *
 * @remarks
 * `@sentry/node` 11 reads the AI SDK's `ai:telemetry` diagnostics channel
 * directly, so it needs neither OpenTelemetry (eve keeps its own provider)
 * nor a load-order guarantee. Every step derives its trace id from eve's
 * root session id the same way eve does, so the foreman and each station
 * of one issue share a trace; incoming-request spans stay off so that trace
 * id is not overridden by eve's per-step workflow requests. The scope
 * attributes ride onto every span, log and metric of the step.
 */
export default defineInstrumentation({
  events: {
    "step.started": (input) => {
      const { session } = input;
      const rootSessionId = session.parent?.rootSessionId ?? session.id;
      const scope = getCurrentScope();
      scope.setPropagationContext({
        sampleRand: Math.random(),
        traceId: createHash("sha256")
          .update(rootSessionId)
          .digest("hex")
          .slice(0, 32),
      });
      setConversationId(rootSessionId);
      scope.setAttributes({
        "factory.issue_number":
          intakeIssueNumber(session.auth.current) ??
          intakeIssueNumber(session.auth.initiator),
        "factory.root_session_id": rootSessionId,
        "factory.station": station(input),
      });
    },
  },
  setup: () => {
    init({
      integrations: [
        consoleLoggingIntegration(),
        httpIntegration({ disableIncomingRequestSpans: true }),
      ],
      tracesSampleRate: 1,
    });
  },
});
