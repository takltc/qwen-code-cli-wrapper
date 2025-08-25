/**
 * Application constants
 */

export const APP_CONFIG = {
	name: 'qwen-worker',
	version: '1.0.0',
} as const;

export const QWEN_CONFIG = {
	defaultModel: 'qwen3-coder-plus',
	supportedModels: ['qwen3-coder-plus', 'qwen3-coder-flash'] as const,
	oauthBaseUrl: 'https://chat.qwen.ai',
	tokenEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/token',
	clientId: 'f0304373b74a44d2b584a3fb70ca9e56',
	scope: 'openid profile email model.completion',
	defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
	tokenRefreshBufferMs: 30_000,
} as const;

export const API_CONFIG = {
	timeout: 30000,
	maxRetries: 3,
	defaultTemperature: 0.7,
	defaultMaxTokens: 1000,
} as const;
