import { describe, it, expect } from 'vitest';
import { transformToResponsesSSE } from '../src/services/responsesTransform';

function upstreamSse(chunks: any[]): Response {
  const enc = new TextEncoder();
  const rs = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const d of chunks) controller.enqueue(enc.encode(`data: ${JSON.stringify(d)}\n\n`));
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(rs, { headers: { 'Content-Type': 'text/event-stream' } });
}

async function collect(resp: Response): Promise<string> {
  return await resp.text();
}

describe('transformToResponsesSSE', () => {
  it('maps chat.completion.chunk into response.* events', async () => {
    const chunk = {
      id: 'id1', object: 'chat.completion.chunk', created: Date.now(), model: 'm',
      choices: [ { index: 0, delta: { content: 'Hello' }, finish_reason: null } ],
    };
    const upstream = upstreamSse([chunk]);
    const transformed = transformToResponsesSSE(upstream, { model: 'm' });
    const text = await collect(transformed);
    expect(text).toContain('event: response.created');
    expect(text).toContain('event: response.output_text.delta');
    expect(text).toContain('Hello');
    expect(text).toContain('event: response.completed');
  });
});

