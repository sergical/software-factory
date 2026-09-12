export const MODELS = {
  analyst: "mistral/devstral-2", // plans on a coding model that costs a fraction of the flagship
  classifier: "mistral/mistral-small", // triage picks labels; the smallest model that calls tools
  implementer: "mistral/devstral-2", // the station that writes the code gets the coding model
  orchestrator: "mistral/mistral-large-3",
  researcher: "mistral/mistral-large-3",
  reviewer: "mistral/mistral-large-3", // a different model than the implementer on purpose: independent review
} as const;

// Mistral only caches a prompt when the request carries a cache key. One key per
// station keeps the shared system prompt warm across runs and within a session.
export const PROMPT_CACHE = Object.fromEntries(
  Object.keys(MODELS).map((station) => [
    station,
    { providerOptions: { mistral: { promptCacheKey: `factory-${station}` } } },
  ]),
) as Record<keyof typeof MODELS, { providerOptions: { mistral: { promptCacheKey: string } } }>;
