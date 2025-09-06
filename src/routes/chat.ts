import type { Hono } from 'hono';
import { QwenOAuthKvClient } from '../services/qwenOAuthKvClient';
import { toUpstreamPayload } from '../services/openaiMapper';
import { chatCompletions, resolveBaseUrl } from '../services/qwenProxy';
import { validateChatBody } from '../config/validation';
import { KV_CREDENTIALS_KEY } from '../services/credentials';
import { AuthService } from '../services/auth';
import type { AssistantToolCall } from '../types/openai';

export function registerChatRoutes<E extends Record<string, unknown>>(app: Hono<E>) {
  app.post('/v1/chat/completions', async (c) => {
    try {
      const env = c.env as {
        QWEN_KV: KVNamespace;
        QWEN_CLI_AUTH?: string;
        OPENAI_MODEL?: string;
        OPENAI_BASE_URL?: string;
        OPENAI_API_KEY?: string;
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

      // Upstream call
      const upstream = await chatCompletions(baseUrl, token, payload, reqId);

      // Streaming: pass-through SSE unmodified (align with Qwen Code)
      if (payload.stream) {
        return upstream;
      }

      // Non-stream JSON: normalize tool_calls and content per OpenAI spec
      const data: any = await upstream.json();
      try {
        if (data && Array.isArray(data.choices)) {
          for (const ch of data.choices) {
            const msg = ch?.message;
            if (msg && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
              const calls: AssistantToolCall[] = msg.tool_calls.map((tc: any) => {
                const fn = tc?.function || {};
                let args = fn.arguments;
                if (args !== undefined && typeof args !== 'string') {
                  try { args = JSON.stringify(args); } catch { args = String(args); }
                }
                return {
                  id: tc.id,
                  type: 'function',
                  function: { name: String(fn.name || tc.name || 'unknown'), arguments: String(args ?? '{}') },
                };
              });
              msg.tool_calls = calls;
              msg.content = null;
            } else if (msg && 'tool_calls' in (msg as any) && (!Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0)) {
              delete msg.tool_calls;
            }
          }
        }
      } catch {
        // best-effort normalization; fall back silently
      }

      return c.json(data as any);
    } catch (err: any) {
      return c.json({ error: { message: err?.message || 'Unknown error' } }, 500);
    }
  });
}
