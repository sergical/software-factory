# Instrumentation

## Files

- `agent/instrumentation.ts`: calls `init` once in `setup` and sets per-step scope state in the `step.started` hook.
- `agent/hooks/sentry.ts` and `agent/subagents/<id>/hooks/sentry.ts`: one `eveConversationHook()` per agent, because a declared subagent inherits no hooks from the root agent.
- `agent/lib/sentry-conversation.ts`: the shared `getConversationId`, which returns the root session id so every station of one issue joins the foreman's conversation.
- `INSTRUMENTATION.md`: this note.

## Mechanism

eve loads `agent/instrumentation.ts` (the legacy single-file layout) after it registers its own OpenTelemetry provider, and `@sentry/node` 11 never touches OpenTelemetry (`enableOpenTelemetrySetup` defaults to `false`), so the two runtimes do not compete: Sentry owns Sentry spans, eve keeps its local OTel provider. The default `vercelAIIntegration` subscribes to the AI SDK's `ai:telemetry` diagnostics channel and emits Sentry-native `invoke_agent`, `generate_content` and `execute_tool` spans with inputs, outputs, tokens and tool errors. Before every model call eve invokes `step.started`, where the hook sets the trace id to `sha256(rootSessionId)` (eve's own scheme) and puts `factory.*` on the scope, which the SDK copies onto every streamed span, log and metric of that step. Conversation ids come from `eveConversationHook()` instead, run through `hooks/sentry.ts` in the root agent and in each declared subagent.

Option (a), a Sentry global provider adopted by eve, and option (b), attaching to eve's provider, are both closed in v11: eve registers its provider before loading instrumentation and throws when another runtime owns it, and `@sentry/opentelemetry` 11 no longer ships `SentrySpanProcessor`. Not using OpenTelemetry at all is the only path, and it is also the shortest.

## Version

`@sentry/node` 11.0.0-rc.0. Breaking changes that mattered: `skipOpenTelemetrySetup` became `enableOpenTelemetrySetup` (default `false`); `@sentry/opentelemetry` lost `SentrySpanProcessor`, `SentrySampler` and `SentryContextManager`; `vercelAIIntegration` reads the AI SDK diagnostics channel instead of OTel spans and has no `force` option; `scope.setAttributes` now applies to streamed spans, logs and metrics.

## What defaults cover

- `vercelAIIntegration`: on by default, needs no options. Inputs and outputs are recorded by default (`dataCollection.genAI` defaults to `true`; `sendDefaultPii` is not needed).
- `conversationIdIntegration`: writes `gen_ai.conversation.id`, set by the `eveConversationHook()` in `hooks/sentry.ts`.
- Errors: `onUncaughtException`, `onUnhandledRejection`, and the integration's `captureToolError` for tool failures. eve swallows tool errors, but the AI SDK reports them as `tool-error` output, which the integration captures.
- Logs: `consoleLoggingIntegration()` is the only opt-in; it routes `console.*` to Sentry logs.
- Metrics: no explicit metrics. `Sentry.metrics` exists in v11, but cost per PR, tool count, tool duration and tokens are derived from span attributes server-side, so nothing is added.
- `dsn`, `release` and `environment` come from `SENTRY_DSN`, `SENTRY_RELEASE`/`VERCEL_GIT_COMMIT_SHA`, `SENTRY_ENVIRONMENT`/`VERCEL_ENV`.
- `httpIntegration({ disableIncomingRequestSpans: true })` is the one non-default option: eve's per-step workflow requests would otherwise become the trace root and split one issue into many traces.

## Attributes confirmed offline

Fake DSN, capturing transport, `MockLanguageModelV3`, two stations: `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.total_tokens`, `gen_ai.conversation.id`, `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.tool.definitions`, `gen_ai.response.finish_reasons`, `execute_tool` spans with `gen_ai.tool.name` and `status: error` for a throwing tool, `factory.station`, `factory.issue_number`, `factory.root_session_id` on spans and log records, one trace id for both stations with `invoke_agent` as parent of `generate_content` and `execute_tool`, a log record per `console.log`, and an error event for the failing tool.

## Confirmed at runtime

Two `eve dev` runs of issue #2 on 2026-09-16 (environment `local`): every `gen_ai` span of the foreman, the classifier and the analyst has `gen_ai.conversation.id` equal to the root session id, one trace id equal to `sha256(rootSessionId)`, `factory.root_session_id`, `factory.station`, and `gen_ai.usage.cache_read.input_tokens`. Sentry lists each run as one titled conversation.

One production run of issue #3 on 2026-09-16 (`wrun_41M2ND4HRK0GVYAYQMZD3GJDNZ`) confirms the same for all five stations, including the implementer and the reviewer and the parallel subagent sessions: 49 model calls, one trace, one titled conversation, cache reads on every model.

Known gaps:

- `factory.station` reads `subagent` for every station. The station name is only in the span name (`invoke_agent implementer`); no span carries `gen_ai.agent.name`, so the conversation flow of a real run is empty.
- A tool that returns `{ success: false }` instead of throwing (`push_branch`, `checkout_branch`) gets span status `ok`, so its failure does not count as a tool error.

## Discrepancies with docs

- The Sentry docs still show `vercelAIIntegration({ force, recordInputs, recordOutputs })` and `skipOpenTelemetrySetup`; neither exists in v11.
- The eve instrumentation cookbook exports through OTLP; it does not mention that the provider directory and the single file cannot be combined, nor that `step.started` is the only hook that runs on the model call's async chain.
