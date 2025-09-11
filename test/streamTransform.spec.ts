import { describe, it, expect } from 'vitest';
import { transformOpenAISSE } from '../src/services/streamTransform';

function sse(data: any[]): Response {
  const enc = new TextEncoder();
  const chunks = data.map((d) => `data: ${JSON.stringify(d)}\n\n`).join('') + 'data: [DONE]\n\n';
  const rs = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(chunks));
      controller.close();
    },
  });
  return new Response(rs, { headers: { 'Content-Type': 'text/event-stream' } });
}

async function collect(resp: Response): Promise<string> {
  const text = await resp.text();
  return text;
}

describe('transformOpenAISSE', () => {
  it('injects tool_calls chunk when tool JSON appears in content', async () => {
    const chunk = {
      id: 'x',
      object: 'chat.completion.chunk',
      created: Date.now(),
      model: 'm',
      choices: [ { index: 0, delta: { role: 'assistant', content: 'Here\n```json\n{"tool_calls":[{"type":"function","function":{"name":"x","arguments":{}}}]}\n```' }, finish_reason: null } ],
    };
    const upstream = sse([chunk]);
    const transformed = transformOpenAISSE(upstream, { enableToolExtraction: true });
    const out = await collect(transformed);
    expect(out).toContain('tool_calls');
    expect(out).toContain('data: [DONE]');
  });

  it('sanitizes headers and appends [DONE] in passthrough mode', async () => {
    // Upstream without [DONE] and with suspicious headers
    const enc = new TextEncoder();
    const rs = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = {
          id: 'x', object: 'chat.completion.chunk', created: Date.now(), model: 'm',
          choices: [ { index: 0, delta: { content: 'hello' }, finish_reason: null } ],
        };
        controller.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        controller.close();
      },
    });
    const upstream = new Response(rs, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip' } });
    const transformed = transformOpenAISSE(upstream, { enableToolExtraction: false });
    const text = await transformed.text();
    expect(transformed.headers.get('content-type')?.startsWith('text/event-stream')).toBeTruthy();
    expect(transformed.headers.get('content-encoding')).toBeNull();
    expect(text).toContain('data: [DONE]');
  });
});
