import { Hono } from 'hono';
import { registerChatRoutes } from './routes/chat';
import { registerHealthRoutes } from './routes/health';
import { registerModelsRoutes } from './routes/models';
import type { Bindings } from './types/bindings';

const app = new Hono<{ Bindings: Bindings }>();

registerHealthRoutes(app);
registerChatRoutes(app);
registerModelsRoutes(app);

export default app;
