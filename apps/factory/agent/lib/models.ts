import { gateway, wrapLanguageModel } from "ai";

// While eve offers `final_output`, the turn ends only through that tool call: a
// step that ends in text fails with OUTPUT_SCHEMA_NOT_FULFILLED, and eve has no
// toolChoice setting. Codestral sometimes writes the `final_output` JSON as
// text. A follow-up turn to the same subagent has no output schema, so eve
// leaves the tool out and a text reply is how that turn ends.
const requireToolCall = (modelId: string) =>
  wrapLanguageModel({
    middleware: {
      transformParams: async ({ params }) =>
        params.tools?.some((t) => t.name === "final_output")
          ? { ...params, toolChoice: { type: "required" as const } }
          : params,
    },
    model: gateway(modelId),
  });

export const MODELS = {
  analyst: "mistral/mistral-large-3", // planning is reasoning over code, and its acceptance criteria are the reviewer's contract
  classifier: "mistral/mistral-small", // triage picks labels; the smallest model that calls tools
  implementer: requireToolCall("mistral/codestral"), // the station that writes the code gets the coding model
  orchestrator: "mistral/mistral-large-3",
  researcher: "mistral/mistral-large-3",
  reviewer: "mistral/mistral-large-3", // a different model than the implementer on purpose: independent review
} as const;

// `eve build` looks up a wrapped gateway model under "gateway/<id>", which the AI
// Gateway catalog does not list, so the build fails without this value. It is
// the catalog's context window for mistral/codestral.
export const CONTEXT_WINDOW_TOKENS = {
  implementer: 128_000,
} satisfies Partial<Record<keyof typeof MODELS, number>>;

// Mistral caches repeated prompt prefixes on its own, so the stations send no
// cache options.
export const PROMPT_CACHE = Object.fromEntries(
  Object.keys(MODELS).map((station) => [station, { providerOptions: { mistral: {} } }])
) as Record<keyof typeof MODELS, { providerOptions: { mistral: Record<string, never> } }>;
