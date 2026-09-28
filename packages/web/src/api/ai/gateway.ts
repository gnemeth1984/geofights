import { createGateway } from "ai";

export const gateway = createGateway({
  baseURL: process.env.AI_GATEWAY_BASE_URL,
  apiKey: process.env.AI_GATEWAY_API_KEY,
});

/** Cheap + fast for bulk content (spawn flavour, battle lines). */
export const FAST_MODEL = "openai/gpt-5.4-mini";
/** Used for richer one-off generation (avatars, legendary boosters, summaries). */
export const SMART_MODEL = "openai/gpt-5.4";

export const aiConfigured = Boolean(process.env.AI_GATEWAY_API_KEY);
