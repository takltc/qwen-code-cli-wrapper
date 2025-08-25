import type { Hono } from 'hono';
import type { ModelsResponse, Model } from '../types/openai';
import { QWEN_CONFIG } from '../config/constants';

// Supported Qwen models only
const QWEN_MODELS: Model[] = QWEN_CONFIG.supportedModels.map((modelId) => ({
	id: modelId,
	object: 'model' as const,
	created: 1700000000,
	owned_by: 'qwen',
}));

export function registerModelsRoutes<E extends Record<string, unknown>>(app: Hono<E>) {
	app.get('/v1/models', (c) => {
		const response: ModelsResponse = {
			object: 'list',
			data: QWEN_MODELS,
		};
		return c.json(response);
	});

	// Also support the deprecated /models endpoint for compatibility
	app.get('/models', (c) => {
		const response: ModelsResponse = {
			object: 'list',
			data: QWEN_MODELS,
		};
		return c.json(response);
	});
}
