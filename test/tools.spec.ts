import { describe, it, expect } from 'vitest';
import { extractToolInvocations, removeToolJsonContent } from '../src/services/tools';

describe('Tool extraction helpers', () => {
  it('extracts tool_calls from fenced JSON', () => {
    const text = [
      'Here is my plan.',
      '```json',
      JSON.stringify({
        tool_calls: [
          { type: 'function', function: { name: 'search_docs', arguments: { query: 'hello', top_k: 3 } } },
        ],
      }),
      '```',
    ].join('\n');

    const calls = extractToolInvocations(text);
    expect(calls).toBeTruthy();
    expect(calls!.length).toBe(1);
    expect(calls![0].function.name).toBe('search_docs');
    expect(typeof calls![0].function.arguments).toBe('string');
  });

  it('removes tool JSON from content', () => {
    const text = 'answer before\n```json\n{"tool_calls":[{"type":"function","function":{"name":"x","arguments":{}}}]}\n```\nafter';
    const cleaned = removeToolJsonContent(text);
    expect(cleaned).toContain('answer before');
    expect(cleaned).toContain('after');
    expect(cleaned.includes('tool_calls')).toBe(false);
  });
});

