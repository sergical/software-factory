import { createHash } from "node:crypto";
import {
  consoleLoggingIntegration,
  getCurrentScope,
  httpIntegration,
  init,
  setConversationId,
  vercelAIIntegration,
} from "@sentry/node";
import {
  defineInstrumentation,
  type InstrumentationRuntimeContextInput,
} from "eve/instrumentation";
import { intakeIssueNumber, intakeIssueTitle } from "./lib/trust.js";

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
        "factory.issue_title":
          intakeIssueTitle(session.auth.current) ??
          intakeIssueTitle(session.auth.initiator),
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
        // Eve passes recordInputs/recordOutputs per call from its channel audience policy, and a
        // channel without a declared audience resolves to false outside `eve dev`. The integration
        // option wins over the per-call value, so the transcript reaches Sentry on every channel.
        vercelAIIntegration({ recordInputs: true, recordOutputs: true }),
      ],
      tracesSampleRate: 1,
      // The gateway answers with the provider's own alias ("mistral-large-latest"),
      // and Sentry prices a call from the name in the response. The alias still
      // carries the previous generation's price list, so the bill reads about four
      // times the gateway invoice. Price the call as the model we asked for, and
      // keep the served name for the record.
      beforeSendSpan: (span) => {
        const attributes = span.attributes;
        const requested = attributes?.["gen_ai.request.model"];
        const served = attributes?.["gen_ai.response.model"];
        if (
          attributes &&
          typeof requested === "string" &&
          typeof served === "string" &&
          requested !== served
        ) {
          attributes["gen_ai.response.model"] = requested;
          attributes["factory.served_model"] = served;
        }
        return span;
      },
    });
  },
});
