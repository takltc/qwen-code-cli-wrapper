// Map OpenAI Chat Completions JSON to OpenAI Responses JSON (non-streaming)

type ChatMessage = { role: string; content: string | null; tool_calls?: unknown[] };
type ChatChoice = { index: number; message: ChatMessage; finish_reason: string | null };
type ChatJson = { id: string; object: string; created: number; model: string; choices: ChatChoice[]; usage?: any };

export function chatJsonToResponses(json: ChatJson) {
  const id = `resp_${json.id || Math.random().toString(36).slice(2)}`;
  const model = json.model;
  const first = (json.choices && json.choices[0]) || ({ message: { content: '' } } as ChatChoice);
  const text = (first.message?.content ?? '') || '';
  const itemId = `msg_${Math.random().toString(36).slice(2)}`;
  return {
    id,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model,
    output: [
      {
        id: itemId,
        type: 'message',
        role: 'assistant',
        content: [ { type: 'text', text } ],
      },
    ],
    usage: json.usage ?? undefined,
  } as const;
}

