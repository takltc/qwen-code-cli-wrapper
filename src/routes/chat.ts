import type { Hono } from 'hono';
import { QwenOAuthKvClient } from '../services/qwenOAuthKvClient';
import { toUpstreamPayload } from '../services/openaiMapper';
import { chatCompletions, resolveBaseUrl } from '../services/qwenProxy';
import { validateChatBody } from '../config/validation';
import { KV_CREDENTIALS_KEY } from '../services/credentials';
import { AuthService } from '../services/auth';
import type { AssistantToolCall, ChatCompletionResponse } from '../types/openai';

export function registerChatRoutes<E extends Record<string, unknown>>(app: Hono<E>) {
  app.post('/v1/chat/completions', async (c) => {
    try {
      const env = c.env as {
        QWEN_KV: KVNamespace;
        QWEN_CLI_AUTH?: string;
        OPENAI_MODEL?: string;
        OPENAI_BASE_URL?: string;
        OPENAI_API_KEY?: string;
        API_TIMEOUT_MS?: string;
        API_MAX_RETRIES?: string;
      };

      // Optional API key auth
      const authService = new AuthService(env);
      const authHeader = c.req.header('Authorization');
      if (authService.isAuthRequired() && !authService.validateApiKey(authHeader)) {
        return c.json({ error: { message: 'Invalid or missing API key. Please provide a valid Authorization header.' } }, 401);
      }

      // Ensure OAuth credentials
      const oauth = new QwenOAuthKvClient(env.QWEN_KV);
      const existing = await env.QWEN_KV.get(KV_CREDENTIALS_KEY);
      if (!existing && env.QWEN_CLI_AUTH) {
        await oauth.loadInitialCredentials(env.QWEN_CLI_AUTH);
      }

      // Validate request and construct upstream payload
      const rawBody = await c.req.json();
      const body = validateChatBody(rawBody);
      const model = body.model || env.OPENAI_MODEL || 'qwen3-coder-plus';
      const payload = toUpstreamPayload(body, model);

      // Acquire token and base URL
      const { token, creds } = await oauth.getValidAccessToken();
      if (!token) {
        return c.json({ error: { message: 'No valid Qwen OAuth token. Provide QWEN_CLI_AUTH or re-authenticate.' } }, 401);
      }
      const baseUrl = resolveBaseUrl(creds || undefined, env.OPENAI_BASE_URL);
      const reqId = c.req.header('x-request-id') || crypto.randomUUID();

      // Resolve timeout/retry from env (optional overrides)
      const parsedTimeout = Number.parseInt((env.API_TIMEOUT_MS || '').trim(), 10);
      const parsedRetries = Number.parseInt((env.API_MAX_RETRIES || '').trim(), 10);
      let effectiveTimeoutMs: number | undefined = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : undefined;
      if (effectiveTimeoutMs === undefined && payload.stream) {
        // Safe default for SSE streaming
        effectiveTimeoutMs = 600_000; // 10 minutes
      }
      const effectiveMaxRetries: number | undefined = Number.isFinite(parsedRetries) && parsedRetries >= 0 ? parsedRetries : undefined;
      const options = {
        timeoutMs: effectiveTimeoutMs,
        maxRetries: effectiveMaxRetries,
      } as { timeoutMs?: number; maxRetries?: number };

      // Upstream call
      const upstream = await chatCompletions(baseUrl, token, payload, reqId, options);

      // Streaming: pass-through SSE unmodified (align with Qwen Code)
      if (payload.stream) {
        return upstream;
      }

      // Non-stream JSON: normalize tool_calls and content per OpenAI spec
      const data = (await upstream.json()) as ChatCompletionResponse | { error?: unknown };
      try {
        if (data && 'choices' in data && Array.isArray((data as ChatCompletionResponse).choices)) {
          for (const ch of (data as ChatCompletionResponse).choices) {
            const msg = ch?.message as { tool_calls?: unknown; content?: string | null } | undefined;
            if (msg && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
              const calls: AssistantToolCall[] = (msg.tool_calls as unknown[]).map((tc: unknown) => {
                const fn = (tc as { function?: { name?: unknown; arguments?: unknown }; name?: unknown; id?: unknown }).function || {} as { name?: unknown; arguments?: unknown };
                let args = fn.arguments as unknown;
                if (args !== undefined && typeof args !== 'string') {
                  try { args = JSON.stringify(args as unknown); } catch { args = String(args); }
                }
                return {
                  id: String((tc as { id?: unknown }).id || ''),
                  type: 'function',
                  function: { name: String((fn.name ?? (tc as { name?: unknown }).name) || 'unknown'), arguments: String((args as string) ?? '{}') },
                };
              });
              (msg as { tool_calls: AssistantToolCall[]; content: null }).tool_calls = calls;
              (msg as { content: null }).content = null;
            } else if (msg && 'tool_calls' in (msg as Record<string, unknown>) && (!Array.isArray((msg as Record<string, unknown>)['tool_calls']) || ((msg as Record<string, unknown>)['tool_calls'] as unknown[]).length === 0)) {
              delete (msg as Record<string, unknown>)['tool_calls'];
            }
          }
        }
      } catch {
        // best-effort normalization; fall back silently
      }

      return c.json(data as unknown as Record<string, unknown>);
    } catch (err) {
      const message = (err && typeof err === 'object' && 'message' in (err as Record<string, unknown>)) ? String((err as { message?: unknown }).message) : 'Unknown error';
      return c.json({ error: { message } }, 500);
    }
  });
}
