# Sentry instrumentation

Sentry project: https://sentry-developer-experience.sentry.io/projects/software-factory/

## Files

- `agent/instrumentation/sentry.ts`: starts the Sentry SDK (`skipOpenTelemetrySetup`, `vercelAIIntegration({ force: true })`, `sendDefaultPii`, `tracesSampleRate: 1`) and owns `flush` and `shutdown`.
- `agent/instrumentation/sentry-spans.ts`: hands `SentrySpanProcessor` to eve's OpenTelemetry pipeline through `otelIntegration`, sets `sentry.op` on eve's `invoke_agent` and `execute_tool` spans, and stamps `factory.issue_number`, `factory.station`, `factory.root_session_id` on every model-call span through eve's runtime context.
- `agent/lib/sentry.ts`: idempotent `Sentry.init`, so either provider file can load first.
- `agent/agent.ts`: `experimental.instrumentationProviders: true` enables the directory layout.

## Mechanism

eve 0.54 owns the global OpenTelemetry tracer provider and registers one pipeline for all `agent/instrumentation/*.ts` files, so Sentry must not register its own. Sentry's span processor joins that pipeline and receives eve's `invoke_agent` and `execute_tool` spans and the AI SDK's `ai.*` spans, which `vercelAIIntegration` maps to `gen_ai.*`. Unset `SENTRY_DSN` leaves both the client and the processor out.

## Attributes confirmed

Offline, with a capturing transport, eve 0.54.2 and `@sentry/node` 10.74.0: one trace id per run; `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.input_tokens.cached`, `gen_ai.agent.name` (eve's span) and `gen_ai.function_id` (Sentry's); tool spans with `gen_ai.tool.name`; ops `gen_ai.invoke_agent`, `gen_ai.generate_content`, `gen_ai.execute_tool`; `factory.issue_number`, `factory.station`, `factory.root_session_id` on the AI SDK spans.

## Discrepancies with Sentry's docs

- docs.sentry.io has no eve page. Sentry's cookbook "Send eve agent traces to Sentry" uses `@vercel/otel` `registerOTel` with an OTLP exporter in the legacy single file `agent/instrumentation.ts`. On eve 0.54 a second `registerOTel` throws ("another runtime already owns the global tracer provider"); the supported route is `otelIntegration({ spanProcessors })`.
- The Node "custom OpenTelemetry setup" page assumes you build the tracer provider and install `SentryContextManager`. eve builds the provider and exposes no context-manager hook, so the SDK runs without it; spans still land in the right trace, and only Sentry scope isolation between concurrent requests is lost.
- The Vercel AI integration page does not say that the `gen_ai` mapping drops `ai.settings.*` attributes. eve's runtime context lands there, so `sentry-spans.ts` copies the `factory.*` values to top-level attributes first.
- `@sentry/opentelemetry` does not infer `op` from `gen_ai.operation.name`; eve's own spans need `sentry.op` set explicitly to appear in the AI Agents view.
