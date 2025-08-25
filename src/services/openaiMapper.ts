import type { OpenAIMessage, ChatCompletionsBody, UpstreamChatCreate } from '../types/openai';
import { validateChatBody } from '../config/validation';

export function toUpstreamPayload(body: ChatCompletionsBody, model: string): UpstreamChatCreate {
	return {
		model,
		messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
		stream: !!body.stream,
		temperature: body.temperature,
		top_p: body.top_p,
		max_tokens: body.max_tokens,
		presence_penalty: body.presence_penalty,
		frequency_penalty: body.frequency_penalty,
		seed: body.seed,
	};
}
