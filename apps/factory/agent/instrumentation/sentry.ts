import { close, flush, setTags } from "@sentry/node";
import { defineInstrumentation } from "eve/instrumentation";
import { sentryClient } from "../lib/sentry.js";

/**
 * Owns the Sentry SDK lifecycle for the factory process.
 *
 * @remarks
 * eve 0.54 owns the OpenTelemetry tracer provider: it registers one pipeline
 * for every `agent/instrumentation/*.ts` file and rejects a second global
 * provider, so `Sentry.init` runs with `skipOpenTelemetrySetup` and the
 * sibling `sentry-spans.ts` hands Sentry's span processor to eve's pipeline.
 * Unset `SENTRY_DSN` leaves the process without a Sentry client and the
 * pipeline without the processor, so eve traces stay local.
 */
export default defineInstrumentation({
  flush: async () => {
    await flush(2000);
  },
  setup: ({ agentName, frameworkVersion }) => {
    if (!sentryClient()) {
      return;
    }
    setTags({
      "agent.name": agentName,
      "eve.version": frameworkVersion ?? "unknown",
    });
  },
  shutdown: async () => {
    await close(2000);
  },
});
