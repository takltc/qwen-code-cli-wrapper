import type { QwenCredentials } from '../types/qwen';
import { normalizeQwenBaseUrl } from '../types/common';
import { QWEN_CONFIG } from '../config/constants';
import type { UpstreamChatCreate } from '../types/openai';
import { API_CONFIG } from '../config/constants';

type MessageLike = { role: string; content: string | unknown[] };

function addCacheControlToMessage(msg: MessageLike) {
  const cc = { type: 'ephemeral' } as const;
  if (typeof msg.content === 'string') {
    msg.content = [{ type: 'text', text: msg.content, cache_control: cc }];
    return;
  }
  if (Array.isArray(msg.content)) {
    if (msg.content.length > 0) {
      const last = msg.content[msg.content.length - 1] as unknown;
      if (last && typeof last === 'object' && (last as { type?: unknown }).type === 'text') {
        const l = last as { type: 'text'; text: string };
        (msg.content as unknown[])[msg.content.length - 1] = { ...l, cache_control: cc } as unknown;
        return;
      }
    }
    (msg.content as unknown[]).push({ type: 'text', text: '', cache_control: cc } as unknown);
  } else {
    msg.content = [{ type: 'text', text: '', cache_control: cc }];
  }
}

function withDashScopeCacheControl(payload: UpstreamChatCreate): UpstreamChatCreate {
  const copy: UpstreamChatCreate = { ...payload, messages: payload.messages.map((m) => ({ role: m.role, content: m.content })) };
  const messages = copy.messages as unknown[];
  if (!messages || messages.length === 0) return copy;
  // Add to system (first system) and possibly last message when streaming
  const firstSystemIdx = (messages as { role: string }[]).findIndex((m) => m.role === 'system');
  if (firstSystemIdx >= 0) addCacheControlToMessage(messages[firstSystemIdx] as MessageLike);
  if (copy.stream) {
    addCacheControlToMessage(messages[messages.length - 1] as MessageLike);
  }
  return copy;
}

export function resolveBaseUrl(creds?: QwenCredentials, fallbackEnv?: string) {
	const resource = creds?.resource_url?.trim();
	const fromEnv = (fallbackEnv ?? '').trim();
	const base = resource || fromEnv || QWEN_CONFIG.defaultBaseUrl;
	return normalizeQwenBaseUrl(base);
}

async function fetchWithRetry(url: string, init: RequestInit, maxRetries: number, timeoutMs: number, initialDelayMs = 4000): Promise<Response> {
	let attempt = 0;
	let delayMs = initialDelayMs;
	const shouldRetry = (err: unknown, resp?: Response) => {
		if (resp) {
			if (resp.status === 429) return true;
			if (resp.status >= 500 && resp.status < 600) return true;
			return false;
		}
		if (err && typeof err === 'object') {
			const name = (err as { name?: string }).name;
			const message = (err as { message?: string }).message || '';
			if (name === 'AbortError') return true;
			if (/Timeout/i.test(message)) return true;
			if (/network|connection|fetch failed|TypeError: Failed to fetch/i.test(message)) return true;
		}
		return false;
	};

	while (true) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(new DOMException('TimeoutError', 'AbortError')), Math.max(0, timeoutMs));
		try {
			const resp = await fetch(url, { ...init, signal: controller.signal });
			clearTimeout(timer);
			if (!resp.ok && shouldRetry(undefined, resp) && attempt < maxRetries) {
				await new Promise((r) => setTimeout(r, delayMs));
				attempt++;
				delayMs = Math.min(delayMs * 2, 30000);
				continue;
			}
			return resp;
		} catch (err) {
			clearTimeout(timer);
			if (attempt >= maxRetries || !shouldRetry(err)) throw err as unknown;
			await new Promise((r) => setTimeout(r, delayMs));
			attempt++;
			delayMs = Math.min(delayMs * 2, 30000);
		}
	}
}

export async function chatCompletions(baseUrl: string, accessToken: string, payload: unknown, requestId?: string, options?: { timeoutMs?: number; maxRetries?: number }) {
	const url = `${baseUrl}/chat/completions`;
	const isDashScope = /dashscope/i.test(baseUrl) || /compatible-mode/i.test(baseUrl);
	const init: RequestInit = {
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
		body: JSON.stringify(isDashScope ? withDashScopeCacheControl(payload as UpstreamChatCreate) : (payload as UpstreamChatCreate)),
	};
	const timeoutMs = options?.timeoutMs ?? API_CONFIG.timeout;
	const maxRetries = Math.max(0, Math.min(10, options?.maxRetries ?? API_CONFIG.maxRetries));
	const resp = await fetchWithRetry(url, init, maxRetries, timeoutMs, 4000);
	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`Upstream ${resp.status} ${resp.statusText}: ${text}`);
	}
	return resp;
}
