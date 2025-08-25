import type { Hono } from 'hono';

export function registerHealthRoutes<E extends Record<string, unknown>>(app: Hono<E>) {
	app.get('/health', (c) => {
		return c.json({
			status: 'ok',
			uptime: Math.floor(Date.now() / 1000),
			version: 'qwen-worker-1.0.0',
		});
	});
}
