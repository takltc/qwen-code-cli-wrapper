import type { QwenCredentials } from '../types/qwen';
import { normalizeQwenBaseUrl } from '../types/common';
import { QWEN_CONFIG } from '../config/constants';

export function resolveBaseUrl(creds?: QwenCredentials, fallbackEnv?: string) {
	const resource = creds?.resource_url?.trim();
	const fromEnv = (fallbackEnv ?? '').trim();
	const base = resource || fromEnv || QWEN_CONFIG.defaultBaseUrl;
	return normalizeQwenBaseUrl(base);
}

export async function chatCompletions(baseUrl: string, accessToken: string, payload: any, requestId?: string) {
	const url = `${baseUrl}/chat/completions`;
	const resp = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
			Accept: 'application/json',
			...(requestId ? { 'x-request-id': requestId } : {}),
		},
		body: JSON.stringify(payload),
	});
	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`Upstream ${resp.status} ${resp.statusText}: ${text}`);
	}
	return resp;
}
