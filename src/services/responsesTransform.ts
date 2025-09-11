type ResponsesTransformOptions = {
  model?: string;
};

// Transform OpenAI Chat Completions SSE (chat.completion.chunk) into Responses API event-based SSE
export function transformToResponsesSSE(upstream: Response, opts: ResponsesTransformOptions = {}): Response {
  const rd = upstream.body;
  const headers = new Headers(upstream.headers);
  headers.set('Content-Type', 'text/event-stream; charset=utf-8');
  headers.set('Cache-Control', 'no-cache');
  headers.set('Connection', 'keep-alive');
  headers.delete('Content-Length');
  headers.delete('content-length');
  headers.delete('Content-Encoding');
  headers.delete('content-encoding');
  headers.delete('Transfer-Encoding');
  headers.delete('transfer-encoding');

  if (!rd) return new Response(null, { headers, status: upstream.status, statusText: upstream.statusText });

  const dec = new TextDecoder();
  const enc = new TextEncoder();

  let pending = '';
  let responseId: string = `resp_${Math.random().toString(36).slice(2)}`;
  let itemId: string = `msg_${Math.random().toString(36).slice(2)}`;
  let createdEmitted = false;
  let structureEmitted = false; // output_item.added + content_part.added
  let accumText = '';
  
  function sse(controller: TransformStreamDefaultController<Uint8Array>, event: string, data: unknown) {
    controller.enqueue(enc.encode(`event: ${event}\n`));
    controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
  }

  const ts = new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      const created_at = Math.floor(Date.now() / 1000);
      // Emit response.created immediately with response object per spec
      createdEmitted = true;
      sse(controller, 'response.created', {
        type: 'response.created',
        response: {
          id: responseId,
          object: 'response',
          created_at,
          status: 'in_progress',
          error: null,
          model: opts.model,
          output: [],
        },
      });
      // Some clients expect an explicit in_progress event
      sse(controller, 'response.in_progress', {
        type: 'response.in_progress',
        response: {
          id: responseId,
          object: 'response',
          created_at,
          status: 'in_progress',
          error: null,
          model: opts.model,
          output: [],
        },
      });
    },
    transform(chunk, controller) {
      const text = pending + dec.decode(chunk, { stream: true });
      const blocks = text.split(/\n\n/);
      const lastPartial = text.endsWith('\n\n') ? '' : blocks.pop() || '';
      pending = lastPartial;

      for (const block of blocks) {
        if (!block) continue;
        const lines = block.split(/\n/);
        for (const line of lines) {
          if (!line.startsWith('data:')) continue; // ignore other lines
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') {
            sse(controller, 'response.output_text.done', { type: 'response.output_text.done', response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, text: accumText });
            sse(controller, 'response.content_part.done', { type: 'response.content_part.done', response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, part: { type: 'text' } });
            sse(controller, 'response.output_item.done', { type: 'response.output_item.done', response_id: responseId, output_index: 0, item: { id: itemId, object: 'realtime.item', type: 'message', status: 'completed', role: 'assistant', content: [ { type: 'text', text: accumText } ] } });
            sse(controller, 'response.completed', {
              type: 'response.completed',
              response: {
                id: responseId,
                object: 'response',
                created_at: Math.floor(Date.now() / 1000),
                status: 'completed',
                model: opts.model,
                output: [
                  {
                    id: itemId,
                    type: 'message',
                    content: [ { type: 'text', text: accumText } ],
                  },
                ],
              },
            });
            controller.enqueue(enc.encode('data: [DONE]\n\n'));
            continue;
          }
          try {
            const obj = JSON.parse(payload) as any;
            if (obj && obj.object === 'chat.completion.chunk' && Array.isArray(obj.choices)) {
              // keep responseId stable across all events; do not overwrite with upstream id
              const choice = obj.choices[0] || {};
              const delta = choice.delta || {};
              if (typeof delta.content === 'string' && delta.content.length > 0) {
                if (!structureEmitted) {
                  structureEmitted = true;
                  sse(controller, 'response.output_item.added', { type: 'response.output_item.added', response_id: responseId, output_index: 0, item: { id: itemId, object: 'realtime.item', type: 'message', status: 'in_progress', role: 'assistant', content: [] } });
                  sse(controller, 'response.content_part.added', { type: 'response.content_part.added', response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, part: { type: 'text', text: '' } });
                }
                sse(controller, 'response.output_text.delta', {
                  type: 'response.output_text.delta',
                  response_id: responseId,
                  item_id: itemId,
                  output_index: 0,
                  content_index: 0,
                  delta: delta.content,
                });
                accumText += delta.content;
              }
              // When upstream emits a finish reason, proactively finish stream for compatibility
              if (choice.finish_reason) {
                sse(controller, 'response.output_text.done', { type: 'response.output_text.done', response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, text: accumText });
                sse(controller, 'response.content_part.done', { type: 'response.content_part.done', response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, part: { type: 'text' } });
                sse(controller, 'response.output_item.done', { type: 'response.output_item.done', response_id: responseId, output_index: 0, item: { id: itemId, object: 'realtime.item', type: 'message', status: 'completed', role: 'assistant', content: [ { type: 'text', text: accumText } ] } });
                sse(controller, 'response.completed', {
                  type: 'response.completed',
                  response: {
                    id: responseId,
                    object: 'response',
                    created_at: Math.floor(Date.now() / 1000),
                    status: 'completed',
                    model: opts.model,
                    output: [
                      { id: itemId, type: 'message', content: [ { type: 'text', text: accumText } ] },
                    ],
                  },
                });
                controller.enqueue(enc.encode('data: [DONE]\n\n'));
                controller.terminate();
              }
              continue;
            }
            // Passthrough non-standard payload as generic delta text if it has `text`
            if (obj && typeof obj.text === 'string') {
              sse(controller, 'response.output_text.delta', { type: 'response.output_text.delta', response_id: responseId, delta: obj.text, item_id: itemId, output_index: 0, content_index: 0 });
              continue;
            }
          } catch {
            // ignore unparsable data lines
          }
        }
      }
    },
    flush(controller) {
      if (!createdEmitted) {
        const created_at = Math.floor(Date.now() / 1000);
        sse(controller, 'response.created', {
          type: 'response.created',
          response: { id: responseId, object: 'response', created_at, status: 'in_progress', error: null, model: opts.model, output: [] },
        });
      }
      sse(controller, 'response.output_text.done', { type: 'response.output_text.done', response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, text: accumText });
      sse(controller, 'response.content_part.done', { type: 'response.content_part.done', response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, part: { type: 'text' } });
      sse(controller, 'response.output_item.done', { type: 'response.output_item.done', response_id: responseId, output_index: 0, item: { id: itemId, object: 'realtime.item', type: 'message', status: 'completed', role: 'assistant', content: [ { type: 'text', text: accumText } ] } });
      sse(controller, 'response.completed', {
        type: 'response.completed',
        response: { id: responseId, object: 'response', created_at: Math.floor(Date.now()/1000), status: 'completed', model: opts.model, output: [ { id: itemId, type: 'message', content: [ { type: 'text', text: accumText } ] } ] },
      });
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
    },
  });

  return new Response(rd.pipeThrough(ts), { headers, status: upstream.status, statusText: upstream.statusText });
}
