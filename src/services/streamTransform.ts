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
  // Always sanitize SSE headers for better client compatibility (e.g. Codex CLI)
  const rd = upstream.body;
  if (!rd) {
    return new Response(null, sanitizeSseHeaders(upstream.headers, upstream.status, upstream.statusText));
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let pending = '';
  let sawDone = false;

  // If tool extraction is disabled, pass through the stream unchanged but still ensure we end with [DONE]
  if (!opts.enableToolExtraction) {
    const passthrough = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true });
        if (/\ndata:\s*\[DONE\]\s*\n?\n/.test(text)) sawDone = true;
        controller.enqueue(chunk);
      },
      flush(controller) {
        if (!sawDone) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        }
        // Close the stream so clients that rely on EOF don't hang
        try { (controller as any).terminate?.(); } catch {}
      },
    });
    return new Response(rd.pipeThrough(passthrough), sanitizeSseHeaders(upstream.headers, upstream.status, upstream.statusText));
  }

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
            sawDone = true;
            newLines.push(line);
            controller.enqueue(encoder.encode(newLines.join('\n') + '\n\n'));
            try { (controller as any).terminate?.(); } catch {}
            return;
          }
          try {
            const obj = JSON.parse(payload) as any;
            if (obj && obj.object === 'chat.completion.chunk' && Array.isArray(obj.choices)) {
              for (const choice of obj.choices) {
                const idx = typeof choice.index === 'number' ? choice.index : 0;
                const delta = choice.delta || {};
                // Only handle structured tool_calls; do not alter JSON or extract from text
                if (Array.isArray((delta as any).tool_calls) && (delta as any).tool_calls.length > 0) {
                  newLines.push('data: ' + JSON.stringify(obj));
                  newLines.push('');
                  const finishChunk = { id: obj.id, object: obj.object, created: obj.created, model: obj.model, choices: [ { index: idx, delta: {}, finish_reason: 'tool_calls' } ] };
                  newLines.push('data: ' + JSON.stringify(finishChunk));
                  newLines.push('');
                  newLines.push('data: [DONE]');
                  controller.enqueue(encoder.encode(newLines.join('\n') + '\n\n'));
                  controller.terminate();
                  return;
                }
                // If upstream signals a finish reason, finish stream
                if (choice.finish_reason) {
                  newLines.push('data: ' + JSON.stringify(obj));
                  newLines.push('');
                  if (!sawDone) { sawDone = true; newLines.push('data: [DONE]'); }
                  controller.enqueue(encoder.encode(newLines.join('\n') + '\n\n'));
                  controller.terminate();
                  return;
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
            sawDone = true;
            newLines.push(line);
            controller.enqueue(encoder.encode(newLines.join('\n') + '\n\n'));
            try { (controller as any).terminate?.(); } catch {}
            return;
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
      if (!sawDone) {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      }
    },
  });

  return new Response(rd.pipeThrough(out), sanitizeSseHeaders(upstream.headers, upstream.status, upstream.statusText));
}

function sanitizeSseHeaders(headers: Headers, status: number, statusText: string) {
  const out = new Headers(headers);
  out.set('Content-Type', 'text/event-stream; charset=utf-8');
  out.set('Cache-Control', 'no-cache');
  out.set('Connection', 'keep-alive');
  out.delete('Content-Length');
  out.delete('content-length');
  out.delete('Content-Encoding');
  out.delete('content-encoding');
  out.delete('Transfer-Encoding');
  out.delete('transfer-encoding');
  return { headers: out, status, statusText } as ResponseInit;
}
