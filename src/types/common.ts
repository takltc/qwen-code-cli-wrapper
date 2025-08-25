/**
 * Common types used across the application
 */

export interface ApiError {
	error: {
		message: string;
		type?: string;
		code?: string;
	};
}

export interface HealthResponse {
	status: 'ok';
	uptime: number;
	version: string;
}

export const KV_CREDENTIALS_KEY = 'qwen_oauth_credentials';
export const TOKEN_REFRESH_BUFFER_MS = 30_000;

/**
 * Normalize Qwen base URL:
 * - ensure protocol
 * - ensure /v1 suffix
 */
export function normalizeQwenBaseUrl(url: string): string {
	const suffix = '/v1';
	const withProto = url.startsWith('http') ? url : `https://${url}`;
	return withProto.endsWith(suffix) ? withProto : `${withProto}${suffix}`;
}

export function isTokenValid(expiry?: number): boolean {
	if (!expiry) return false;
	return Date.now() < expiry - TOKEN_REFRESH_BUFFER_MS;
}
