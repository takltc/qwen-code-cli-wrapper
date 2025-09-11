import type { Hono } from 'hono';
import { QwenOAuthKvClient } from '../services/qwenOAuthKvClient';
import { validateModel } from '../config/validation';
import { KV_CREDENTIALS_KEY } from '../types/common';
import { resolveBaseUrl, chatCompletions } from '../services/qwenProxy';
import { AuthService } from '../services/auth';
import { transformToResponsesSSE } from '../services/responsesTransform';
import { chatJsonToResponses } from '../services/responsesMapper';
import { toUpstreamPayload } from '../services/openaiMapper';
import type { Tool, ToolChoice, OpenAIMessage, ChatCompletionsBody } from '../types/openai';

type ResponsesBody = {
  model?: string;
  input?: unknown;
  messages?: Array<{ role: string; content: unknown }>; // fallback
  stream?: boolean;
  tools?: Tool[];
  tool_choice?: ToolChoice;
};

type ContentPart = { type: string; text?: string } & Record<string, unknown>;

function toTextParts(parts: unknown): Array<{ type: 'text'; text: string }> {
  if (!Array.isArray(parts)) return [];
  const out: Array<{ type: 'text'; text: string }> = [];
  for (const p of parts as ContentPart[]) {
    if (!p || typeof p !== 'object') continue;
    if (p.type === 'text' && typeof p.text === 'string') {
      out.push({ type: 'text', text: p.text });
    } else if (p.type === 'input_text' && typeof p.text === 'string') {
      out.push({ type: 'text', text: p.text });
    } else if (typeof (p as any).text === 'string') {
      out.push({ type: 'text', text: String((p as any).text) });
    }
  }
  return out;
}

function toMessagesFromResponses(body: ResponsesBody): Array<{ role: string; content: string | Array<{ type: string; text: string }> }> {
  // Priority: messages field → input (array) → input (string)
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    return body.messages.map((m) => {
      const arr = toTextParts((m as any).content);
      if (arr.length > 0) return { role: String((m as any).role), content: arr } as any;
      return { role: String((m as any).role), content: String((m as any).content ?? '') } as any;
    });
  }
  if (Array.isArray(body.input)) {
    // Expect array of content parts or message-like objects
    // Accept simplest case: [{ role, content: [{type:'text', text: '...'}]}]
    const first = body.input[0] as any;
    if (first && typeof first === 'object' && first.role && first.content) {
      return (body.input as any[]).map((m) => {
        const arr = toTextParts(m.content);
        if (arr.length > 0) return { role: String(m.role), content: arr } as any;
        return { role: String(m.role), content: String(m.content ?? '') } as any;
      });
    }
    // Or collapse to a single user message concatenating text parts
    const texts = (body.input as any[])
      .map((p) => (p && typeof p === 'object' && typeof (p as any).text === 'string' ? String((p as any).text) : ''))
      .filter(Boolean)
      .join('\n');
    return [ { role: 'user', content: texts || ' ' } ];
  }
  if (typeof body.input === 'string') {
    return [ { role: 'user', content: body.input } ];
  }
  throw new Error('Invalid Responses payload: provide messages or input');
}

export function registerResponsesRoutes<E extends Record<string, unknown>>(app: Hono<E>) {
  app.post('/v1/responses', async (c) => {
    try {
      const env = c.env as {
        QWEN_KV: KVNamespace;
        QWEN_CLI_AUTH?: string;
        OPENAI_BASE_URL?: string;
        API_TIMEOUT_MS?: string;
        API_MAX_RETRIES?: string;
        OPENAI_API_KEY?: string;
        OPENAI_MODEL?: string;
      };

      // Optional API key auth
      const authService = new AuthService(env as any);
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

      const raw = (await c.req.json()) as ResponsesBody;
      // Codex CLI may send OpenAI models (e.g., gpt-4o). Force Qwen model for upstream.
      const model = validateModel((env.OPENAI_MODEL as string) || 'qwen3-coder-plus');
      const messages = toMessagesFromResponses(raw) as unknown as OpenAIMessage[];

      const { token, creds } = await oauth.getValidAccessToken();
      if (!token) return c.json({ error: { message: 'No valid Qwen OAuth token.' } }, 401);
      const baseUrl = resolveBaseUrl(creds || undefined, env.OPENAI_BASE_URL);

      const wantStream = (raw.stream !== false);
      const body: ChatCompletionsBody = {
        model,
        messages,
        stream: wantStream,
        ...(Array.isArray(raw.tools) ? { tools: raw.tools as Tool[] } : {}),
        ...(raw.tool_choice !== undefined ? { tool_choice: raw.tool_choice as ToolChoice } : {}),
      };
      const payload = toUpstreamPayload(body, model);

      // Upstream call
      const upstream = await chatCompletions(baseUrl, token, payload, c.req.header('x-request-id') || crypto.randomUUID());
      if (wantStream) {
        // Transform into Responses API SSE
        return transformToResponsesSSE(upstream, { model });
      }
      const json = await upstream.json();
      const mapped = chatJsonToResponses(json as any);
      return c.json(mapped as any);
    } catch (err) {
      const message = (err && typeof err === 'object' && 'message' in (err as any)) ? String((err as any).message) : 'Unknown error';
      return c.json({ error: { message } }, 500);
    }
  });
}
