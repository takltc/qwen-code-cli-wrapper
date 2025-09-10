import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Worker routes', () => {
  it('GET /health returns ok', async () => {
    const request = new IncomingRequest('http://example.com/health', { method: 'GET' });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe('ok');
  });

  it('GET /v1/models lists qwen models', async () => {
    const response = await SELF.fetch('https://example.com/v1/models');
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.object).toBe('list');
    expect(Array.isArray(json.data)).toBe(true);
  });
});
