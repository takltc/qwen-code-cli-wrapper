/**
 * Qwen-specific types
 */

export interface QwenCredentials {
	access_token?: string;
	refresh_token?: string;
	id_token?: string;
	expiry_date?: number;
	token_type?: string;
	resource_url?: string;
}

export interface TokenRefreshResponse {
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token?: string;
	resource_url?: string;
}

export interface ErrorResponse {
	error: string;
	error_description: string;
}

export interface QwenOAuth2Client {
	setCredentials(credentials: QwenCredentials): Promise<void>;
	getCredentials(): Promise<QwenCredentials | null>;
	clearCredentials(): Promise<void>;
	getValidAccessToken(): Promise<{ token?: string; creds?: QwenCredentials }>;
	refreshAccessToken(creds: QwenCredentials): Promise<QwenCredentials>;
}
