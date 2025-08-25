export type QwenCredentials = {
	access_token?: string;
	refresh_token?: string;
	id_token?: string;
	expiry_date?: number;
	token_type?: string;
	resource_url?: string;
};

export const KV_CREDENTIALS_KEY = 'qwen_oauth_credentials';
export const TOKEN_REFRESH_BUFFER_MS = 30_000;

export function isTokenValid(expiry?: number) {
	if (!expiry) return false;
	return Date.now() < expiry - TOKEN_REFRESH_BUFFER_MS;
}

/**
 * Normalize Qwen base URL:
 * - ensure protocol
 * - ensure /v1 suffix
 */
export function normalizeQwenBaseUrl(url: string) {
	const suffix = '/v1';
	const withProto = url.startsWith('http') ? url : `https://${url}`;
	return withProto.endsWith(suffix) ? withProto : `${withProto}${suffix}`;
}
