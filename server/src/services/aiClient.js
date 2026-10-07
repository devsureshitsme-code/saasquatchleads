/**
 * Provider-agnostic LLM client that always returns JSON matching a schema.
 *
 * AI_PROVIDER picks the backend:
 *   groq        free tier, very fast; gpt-oss models support strict JSON schema     (recommended free option)
 *   gemini      Google AI Studio free tier, via its OpenAI-compatible endpoint
 *   openrouter  many models; ":free" models are limited to ~50 requests/day without credits
 *   openai      OpenAI
 *   anthropic   Claude Messages API with output_config.format (structured outputs)
 *   custom      any other OpenAI-compatible server (set AI_BASE_URL), e.g. a local Ollama
 *
 * For OpenAI-compatible providers we ask for `response_format: json_schema` (strict). If the
 * model/provider rejects that, we fall back to `json_object` with the schema in the prompt, and
 * finally to plain text, then parse and normalize the JSON to the schema either way. The mode
 * that worked is remembered so later calls don't pay for the failed attempts.
 *
 * Free tiers have per-minute limits, so calls are spaced (AI_RPM) and 429s are retried with
 * Retry-After.
 */

const PRESETS = {
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-20b', rpm: 25, label: 'Groq' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash', rpm: 8, label: 'Google Gemini' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', rpm: 15, label: 'OpenRouter' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', rpm: 60, label: 'OpenAI' },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-4-5-20251001', rpm: 50, label: 'Claude' },
  custom: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', rpm: 60, label: 'Custom' },
};

class AiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Resolve settings from env. ANTHROPIC_API_KEY alone still works (backwards compatible). */
function settings() {
  const env = process.env;
  let provider = (env.AI_PROVIDER || '').toLowerCase().trim();
  if (!provider) provider = env.ANTHROPIC_API_KEY ? 'anthropic' : env.AI_API_KEY ? 'groq' : '';
  const preset = PRESETS[provider];
  if (!preset) return { provider: provider || null, enabled: false };
  const apiKey = env.AI_API_KEY || (provider === 'anthropic' ? env.ANTHROPIC_API_KEY : '') || '';
  const baseUrl = (env.AI_BASE_URL || (provider === 'anthropic' ? env.ANTHROPIC_BASE_URL : '') || preset.baseUrl).replace(/\/$/, '');
  const model = env.AI_MODEL || (provider === 'anthropic' ? env.ANTHROPIC_MODEL : '') || preset.model;
  const rpm = Number(env.AI_RPM) || preset.rpm;
  return { provider, label: preset.label, apiKey, baseUrl, model, rpm, enabled: !!apiKey || provider === 'custom' };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Spacing between call starts so free-tier per-minute limits aren't hit.
let nextSlot = 0;
async function waitForSlot(rpm) {
  const gap = Math.ceil(60_000 / Math.max(rpm, 1));
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + gap;
  if (at > now) await sleep(at - now);
}

/** Pull a JSON object out of model text (handles ```json fences and leading chatter). */
function extractJson(text) {
  if (!text) throw new Error('empty');
  const cleaned = String(text).replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('no json');
  }
}

/** Coerce a parsed object to the schema: keep known keys, fill missing ones, fix simple types. */
function normalizeToSchema(value, schema) {
  if (!schema || schema.type !== 'object') return value;
  const out = {};
  const src = value && typeof value === 'object' ? value : {};
  for (const [key, prop] of Object.entries(schema.properties || {})) {
    let v = src[key];
    const types = [].concat(prop.type || []);
    if (v === undefined || v === '') v = types.includes('null') ? null : types.includes('array') ? [] : types.includes('string') ? '' : null;
    if (types.includes('array') && v !== null && !Array.isArray(v)) v = [v].filter((x) => x !== null && x !== undefined && x !== '');
    if (types.includes('array') && Array.isArray(v)) v = v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
    if ((types.includes('integer') || types.includes('number')) && typeof v === 'string') {
      const n = Number(v.replace(/[^0-9.-]/g, ''));
      v = Number.isFinite(n) ? (types.includes('integer') ? Math.round(n) : n) : null;
    }
    if (types.includes('boolean') && typeof v === 'string') v = /^(true|yes)$/i.test(v) ? true : /^(false|no)$/i.test(v) ? false : null;
    if (prop.enum && !prop.enum.includes(v)) v = prop.enum[0];
    out[key] = v;
  }
  return out;
}

function describeSchema(schema) {
  return `Respond with ONLY a JSON object (no prose, no code fences) matching this JSON Schema:\n${JSON.stringify(schema)}`;
}

// ------------------------------------------------------------------ Anthropic

async function callAnthropic(s, { system, prompt, schema, maxTokens }) {
  const res = await fetch(`${s.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': s.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: s.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: { type: 'json_schema', schema } },
    }),
  });
  const body = await res.json().catch(() => ({}));
  const text = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { res, body, text };
}

// ------------------------------------------------------------------ OpenAI-compatible

const MODES = ['json_schema', 'json_object', 'plain'];
const workingMode = new Map(); // `${baseUrl}|${model}` -> mode index
// Reasoning models (e.g. Groq's gpt-oss) spend hidden thinking tokens out of max_tokens. Without
// headroom the JSON gets cut off mid-string and the provider rejects it (json_validate_failed).
const REASONING_HEADROOM = 1500;

async function callOpenAiCompatible(s, { system, prompt, schema, maxTokens }) {
  const key = `${s.baseUrl}|${s.model}`;
  for (let i = workingMode.get(key) ?? 0; i < MODES.length; i++) {
    const mode = MODES[i];
    const sys = mode === 'json_schema' ? system : `${system}\n\n${describeSchema(schema)}`;
    const body = {
      model: s.model,
      max_tokens: maxTokens + REASONING_HEADROOM,
      temperature: 0.2,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: prompt },
      ],
    };
    if (mode === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } };
    if (mode === 'json_object') body.response_format = { type: 'json_object' };

    const headers = { 'content-type': 'application/json' };
    if (s.apiKey) headers.authorization = `Bearer ${s.apiKey}`;
    if (s.provider === 'openrouter') {
      headers['http-referer'] = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
      headers['x-title'] = 'SaaSquatchLeads';
    }
    const res = await fetch(`${s.baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    const errMsg = JSON.stringify(json.error || '').toLowerCase();
    // The provider/model doesn't support this response_format, or its output failed the
    // provider's own JSON validation (Groq: json_validate_failed): try the next mode.
    if (res.status === 400 && mode !== 'plain' && /response_format|json_schema|json_object|json_validate_failed|failed to validate json|structured|not supported|unsupported|schema/.test(errMsg)) continue;
    const text = json.choices?.[0]?.message?.content || '';
    if (res.ok) {
      try {
        extractJson(text);
        workingMode.set(key, i);
      } catch {
        if (mode !== 'plain') continue; // model ignored the format; try a looser mode
      }
    }
    return { res, body: json, text };
  }
  throw new AiError('The AI model could not produce JSON. Try a different AI_MODEL.', 502);
}

// ------------------------------------------------------------------ public

async function callModel({ system, prompt, schema, maxTokens = 1024 }, attempt = 0) {
  const s = settings();
  if (!s.enabled) {
    throw new AiError('AI is not configured. Set AI_PROVIDER and AI_API_KEY in server/.env (Groq and Gemini have free tiers).', 400);
  }
  await waitForSlot(s.rpm);
  const { res, body, text } = s.provider === 'anthropic' ? await callAnthropic(s, { system, prompt, schema, maxTokens }) : await callOpenAiCompatible(s, { system, prompt, schema, maxTokens });

  if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 3) {
    const retryAfter = Number(res.headers.get('retry-after')) || 2 ** (attempt + 1);
    await sleep(Math.min(retryAfter, 30) * 1000);
    return callModel({ system, prompt, schema, maxTokens }, attempt + 1);
  }
  if (!res.ok) {
    const raw = body.error?.message || (typeof body.error === 'string' ? body.error : '') || `${s.label} API error (${res.status})`;
    if (res.status === 401 || res.status === 403) throw new AiError(`${s.label} rejected the API key (AI_API_KEY).`, 400);
    if (res.status === 429) throw new AiError(`${s.label} rate limit reached. Free tiers reset daily; try again later or lower AI_MAX_PER_JOB.`, 429);
    if (res.status === 404) throw new AiError(`${s.label} doesn't know the model “${s.model}”. Set AI_MODEL to a current model id.`, 400);
    throw new AiError(raw, 502);
  }
  try {
    return { data: normalizeToSchema(extractJson(text), schema), usage: body.usage || null };
  } catch {
    throw new AiError(`${s.label} returned an unreadable response.`, 502);
  }
}

const available = () => settings().enabled;
const info = () => {
  const s = settings();
  return { available: s.enabled, provider: s.enabled ? s.provider : null, label: s.enabled ? s.label : null, model: s.enabled ? s.model : null };
};

module.exports = { callModel, available, info, settings, extractJson, normalizeToSchema, AiError, PRESETS, _resetModes: () => workingMode.clear() };
