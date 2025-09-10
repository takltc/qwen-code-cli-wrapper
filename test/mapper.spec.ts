import { describe, it, expect } from 'vitest';
import { toUpstreamPayload } from '../src/services/openaiMapper';

describe('toUpstreamPayload', () => {
  it('maps function role to tool role upstream', () => {
    const body: any = {
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: null, tool_calls: [ { id: 'abc', type: 'function', function: { name: 'foo', arguments: '{"x":1}' } } ] },
        { role: 'function', name: 'foo', tool_call_id: 'abc', content: 'ok' },
        { role: 'user', content: 'continue' },
      ],
    };
    const upstream = toUpstreamPayload(body, 'qwen3-coder-plus');
    // assistant tool_calls preserved as assistant with null content
    const assistantIdx = upstream.messages.findIndex((m) => m.role === 'assistant');
    expect(assistantIdx).toBeGreaterThanOrEqual(0);
    expect(upstream.messages[assistantIdx].content).toBeNull();
    // tool message normalized from function
    const toolIdx = upstream.messages.findIndex((m) => m.role === 'tool');
    expect(toolIdx).toBeGreaterThanOrEqual(0);
    expect((upstream.messages[toolIdx] as any).name).toBe('foo');
  });
});
