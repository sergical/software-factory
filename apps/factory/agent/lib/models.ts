export const MODELS = {
  analyst: "mistral/devstral-2", // plans on a coding model that costs a fraction of the flagship
  classifier: "mistral/mistral-small", // triage picks labels; the smallest model that calls tools
  implementer: "mistral/devstral-2", // the station that writes the code gets the coding model
  orchestrator: "mistral/mistral-large-3",
  researcher: "mistral/mistral-large-3",
  reviewer: "mistral/mistral-large-3", // a different model than the implementer on purpose: independent review
} as const;
