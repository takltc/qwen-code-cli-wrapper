import { extractToolInvocations, removeToolJsonContent, sanitizeToolCalls } from './tools';

type TransformOptions = {
  enableToolExtraction?: boolean;
};

/**
 * Wrap an OpenAI-compatible SSE response and optionally extract tool calls from streamed content
 * into structured delta.tool_calls chunks.
 *
 * Best-effort: works when the model emits a complete JSON block for tool_calls in one or a few chunks.
 */
export function transformOpenAISSE(upstream: Response, opts: TransformOptions = {}): Response {
  if (!opts.enableToolExtraction) return upstream;
  const rd = upstream.body;
  if (!rd) return upstream;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const buffers: Record<number, string> = {};
  const emittedForIndex: Record<number, boolean> = {};
  let pending = '';

  const out = new TransformStream<Uint8Array, Uint8Array>({
    start() {},
    transform(chunk, controller) {
      const text = pending + decoder.decode(chunk, { stream: true });
      // Split into events by double newlines; keep trailing partial across chunks
      const parts = text.split(/\n\n/);
      // If the last part is not a full event (no trailing blank line), buffer it for next chunk
      const lastIsPartial = !text.endsWith('\n\n');
      const events = lastIsPartial ? parts.slice(0, -1) : parts;
      pending = lastIsPartial ? parts[parts.length - 1] : '';
      for (let e = 0; e < events.length; e++) {
        let block = events[e];
        if (!block) {
          controller.enqueue(encoder.encode('\n'));
          continue;
        }

        // Only transform data: lines; forward others untouched
        const lines = block.split(/\n/);
        const newLines: string[] = [];
        for (const line of lines) {
          if (!line.startsWith('data:')) {
            newLines.push(line);
            continue;
          }
          const payload = line.slice(5).trimStart();
          if (payload === '[DONE]') {
            newLines.push(line);
            continue;
          }
          try {
            const obj = JSON.parse(payload) as any;
            if (obj && obj.object === 'chat.completion.chunk' && Array.isArray(obj.choices)) {
              for (const choice of obj.choices) {
                const idx = typeof choice.index === 'number' ? choice.index : 0;
                const delta = choice.delta || {};
                if (typeof delta.content === 'string' && delta.content.length > 0) {
                  buffers[idx] = (buffers[idx] || '') + delta.content;
                  if (!emittedForIndex[idx]) {
                    const extracted = extractToolInvocations(buffers[idx]);
                    if (extracted && extracted.length > 0) {
                      const calls = sanitizeToolCalls(extracted).map((c, i) => ({ ...c, index: i }));
                      // Emit a synthetic tool_calls chunk immediately after this one
                      const toolChunk = {
                        id: obj.id,
                        object: obj.object,
                        created: obj.created,
                        model: obj.model,
                        choices: [
                          {
                            index: idx,
                            delta: { tool_calls: calls },
                            finish_reason: null,
                          },
                        ],
                      };
                      emittedForIndex[idx] = true;
                      // Clean current delta.content to remove JSON
                      const cleaned = removeToolJsonContent(delta.content || '');
                      choice.delta.content = cleaned || undefined;
                      newLines.push('data: ' + JSON.stringify(obj));
                      newLines.push('');
                      newLines.push('data: ' + JSON.stringify(toolChunk));
                      continue;
                    }
                  }
                  // If not emitting tool_calls yet, still try to remove any partial fenced JSON from this delta
                  const cleaned = removeToolJsonContent(delta.content || '');
                  if (cleaned !== delta.content) {
                    choice.delta.content = cleaned || undefined;
                    newLines.push('data: ' + JSON.stringify(obj));
                    continue;
                  }
                }
              }
            }
            // Default: forward as-is
            newLines.push('data: ' + JSON.stringify(obj));
          } catch {
            // Not JSON; forward unmodified
            newLines.push(line);
          }
        }
        controller.enqueue(encoder.encode(newLines.join('\n') + '\n\n'));
      }
    },
    flush(controller) {
      if (!pending) return;
      // Attempt to process any remaining partial block conservatively
      const block = pending;
      pending = '';
      const lines = block.split(/\n/);
      const newLines: string[] = [];
      for (const line of lines) {
        if (!line.startsWith('data:')) {
          newLines.push(line);
          continue;
        }
        const payload = line.slice(5).trimStart();
        if (payload === '[DONE]') {
          newLines.push(line);
          continue;
        }
        try {
          const obj = JSON.parse(payload) as any;
          newLines.push('data: ' + JSON.stringify(obj));
        } catch {
          // Emit as-is if not valid JSON
          newLines.push(line);
        }
      }
      controller.enqueue(encoder.encode(newLines.join('\n') + '\n\n'));
    },
  });

  return new Response(rd.pipeThrough(out), {
    headers: upstream.headers,
    status: upstream.status,
    statusText: upstream.statusText,
  });
}

