import type { QwenCredentials } from '../types/qwen';
import { normalizeQwenBaseUrl } from '../types/common';
import { QWEN_CONFIG } from '../config/constants';
import type { UpstreamChatCreate } from '../types/openai';

function addCacheControlToMessage(msg: { role: string; content: any }) {
  const cc = { type: 'ephemeral' } as const;
  if (typeof msg.content === 'string') {
    msg.content = [{ type: 'text', text: msg.content, cache_control: cc }];
    return;
  }
  if (Array.isArray(msg.content)) {
    if (msg.content.length > 0) {
      const last = msg.content[msg.content.length - 1];
      if (last && typeof last === 'object' && last.type === 'text') {
        msg.content[msg.content.length - 1] = { ...last, cache_control: cc };
        return;
      }
    }
    msg.content.push({ type: 'text', text: '', cache_control: cc });
  } else {
    msg.content = [{ type: 'text', text: '', cache_control: cc }];
  }
}

function withDashScopeCacheControl(payload: UpstreamChatCreate): UpstreamChatCreate {
  const copy: UpstreamChatCreate = { ...payload, messages: payload.messages.map((m) => ({ role: m.role, content: m.content })) };
  const messages = copy.messages as any[];
  if (!messages || messages.length === 0) return copy;
  // Add to system (first system) and possibly last message when streaming
  const firstSystemIdx = messages.findIndex((m) => m.role === 'system');
  if (firstSystemIdx >= 0) addCacheControlToMessage(messages[firstSystemIdx]);
  if (copy.stream) {
    addCacheControlToMessage(messages[messages.length - 1]);
  }
  return copy;
}

export function resolveBaseUrl(creds?: QwenCredentials, fallbackEnv?: string) {
	const resource = creds?.resource_url?.trim();
	const fromEnv = (fallbackEnv ?? '').trim();
	const base = resource || fromEnv || QWEN_CONFIG.defaultBaseUrl;
	return normalizeQwenBaseUrl(base);
}

export async function chatCompletions(baseUrl: string, accessToken: string, payload: any, requestId?: string) {
	const url = `${baseUrl}/chat/completions`;
	const isDashScope = /dashscope/i.test(baseUrl) || /compatible-mode/i.test(baseUrl);
	const resp = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
			// Align with Qwen Code: accept SSE + JSON
			Accept: 'application/json, text/event-stream',
			...(isDashScope ? { 'X-DashScope-CacheControl': 'enable' } : {}),
			...(isDashScope ? { 'X-DashScope-UserAgent': 'qwen-code-cli-wrapper/1.0' } : {}),
			...(requestId ? { 'x-request-id': requestId } : {}),
		},
    body: JSON.stringify(isDashScope ? withDashScopeCacheControl(payload as UpstreamChatCreate) : payload),
  });
	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`Upstream ${resp.status} ${resp.statusText}: ${text}`);
	}
	return resp;
}
