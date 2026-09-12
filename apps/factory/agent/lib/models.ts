// One place to change every agent's model. Ids are Vercel AI Gateway strings (<provider>/<model>),
// so routing, credentials, and fallbacks stay on the gateway and no provider SDK is wired in.
// Each agent.ts reads its entry here (model: MODELS.<agent>) instead of hardcoding a string.
export const MODELS = {
  analyst: "mistral/devstral-2", // plan on a coding model that costs a fraction of the flagship
  classifier: "mistral/mistral-small", // triage picks labels; the smallest model that calls tools
  implementer: "anthropic/claude-fable-5", // the station that writes the code gets the strongest coding model
  orchestrator: "openai/gpt-5.6-terra-fast",
  researcher: "openai/gpt-5.6-terra-fast",
  reviewer: "openai/gpt-5.6-terra-fast", // different vendor than implementer on purpose: independent review
} as const;

export type FactoryAgent = keyof typeof MODELS;
