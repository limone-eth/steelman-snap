const OpenAI = require('openai');

/**
 * OpenRouter exposes an OpenAI-compatible API. Docs: https://openrouter.ai/docs
 */
function createOpenRouterClient() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }
  const headers = {};
  if (process.env.OPENROUTER_HTTP_REFERER) {
    headers['HTTP-Referer'] = process.env.OPENROUTER_HTTP_REFERER;
  }
  if (process.env.OPENROUTER_APP_NAME) {
    headers['X-Title'] = process.env.OPENROUTER_APP_NAME;
  }
  return new OpenAI({
    apiKey,
    baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    defaultHeaders: Object.keys(headers).length ? headers : undefined
  });
}

/** Default chat model (override with OPENROUTER_MODEL). Use a vision-capable id if you use image embeds. */
function defaultChatModel() {
  return process.env.OPENROUTER_MODEL || 'openai/gpt-4o';
}

module.exports = { createOpenRouterClient, defaultChatModel };
