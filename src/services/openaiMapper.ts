import type { ChatCompletionsBody, UpstreamChatCreate, OpenAIContentItem, OpenAIMessage, AssistantToolCall } from '../types/openai';
import { processMessagesWithTools, preprocessMessagesForUpstream } from './tools';

function normalizeContent(content: string | OpenAIContentItem[]): string {
	if (typeof content === 'string') {
		return content;
	}

	// For array content, extract text from all known text-like items
	return content
		.map((item) => {
			if ((item as any)?.type === 'text' && typeof (item as any).text === 'string') return (item as any).text as string;
			// Responses API often uses input_text; treat it as text
			if ((item as any)?.type === 'input_text' && typeof (item as any).text === 'string') return (item as any).text as string;
			return '';
		})
		.filter(Boolean)
		.join('\n');
}

type MappedAssistantToolCall = {
	id?: string;
	type: 'function';
	function: { name: string; arguments: string };
};

type MappedMessage =
	| { role: 'assistant'; content: null; tool_calls: MappedAssistantToolCall[] }
	| { role: 'tool'; tool_call_id?: string; name?: string; content: string }
	| { role: Exclude<OpenAIMessage['role'], 'assistant' | 'tool'>; content: string };

export function toUpstreamPayload(body: ChatCompletionsBody, model: string): UpstreamChatCreate {
	// Inject tool prompt (no TOOL_HISTORY), keep tool semantics (aligned with qwen-code)
	const messagesWithTools = processMessagesWithTools(body.messages, body.tools, body.tool_choice);
	// Clean orphaned tool calls and merge consecutive assistant messages (align with qwen-code)
	const processed = preprocessMessagesForUpstream(messagesWithTools);

	// Preserve tool semantics for upstream (assistant.tool_calls, tool messages)
	const mappedMessages: MappedMessage[] = [];
	for (const m of processed) {
		if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
			const toolCalls: MappedAssistantToolCall[] = (m.tool_calls as AssistantToolCall[]).map((tc) => ({
				id: tc.id,
				type: 'function',
				function: {
					name: String(tc.function?.name || 'unknown'),
					arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments ?? '{}'),
				},
			}));
			mappedMessages.push({ role: 'assistant', content: null, tool_calls: toolCalls });
			continue;
		}
    if (m.role === 'tool' || m.role === 'function') {
        mappedMessages.push({
            role: 'tool',
            tool_call_id: (m as { tool_call_id?: string }).tool_call_id,
            name: (m as { name?: string }).name,
            content: normalizeContent(m.content as string | OpenAIContentItem[]),
        });
        continue;
    }
		mappedMessages.push({ role: m.role as Exclude<OpenAIMessage['role'], 'assistant' | 'tool'>, content: normalizeContent(m.content as string | OpenAIContentItem[]) });
	}

	return {
		model,
		messages: mappedMessages as unknown as UpstreamChatCreate['messages'],
		stream: !!body.stream,
		temperature: body.temperature,
		top_p: body.top_p,
		max_tokens: body.max_tokens,
		presence_penalty: body.presence_penalty,
		frequency_penalty: body.frequency_penalty,
		seed: body.seed,
		tools: body.tools,
		tool_choice: body.tool_choice,
	};
}
