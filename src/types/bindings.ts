/**
 * Cloudflare Worker Bindings
 */
export interface Bindings {
	QWEN_KV: KVNamespace;
	QWEN_CLI_AUTH?: string;
	OPENAI_MODEL?: string;
	OPENAI_BASE_URL?: string;
	OPENAI_API_KEY?: string; // User-facing API key for authentication
	API_TIMEOUT_MS?: string;
	API_MAX_RETRIES?: string;
	TOOL_SUPPORT?: string; // 'true' to enable tool extraction pipeline
}

/**
 * Environment configuration interface
 */
export interface Environment {
	kv: KVNamespace;
	qwenCliAuth?: string;
	openaiModel?: string;
	openaiBaseUrl?: string;
	openaiApiKey?: string;
}
