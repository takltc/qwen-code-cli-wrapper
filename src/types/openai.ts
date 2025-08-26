/**
 * OpenAI API Types
 */

export interface OpenAITextContent {
	type: 'text';
	text: string;
}

export interface OpenAIImageContent {
	type: 'image_url';
	image_url: {
		url: string;
		detail?: 'auto' | 'low' | 'high';
	};
}

export type OpenAIContentItem = OpenAITextContent | OpenAIImageContent;

export interface OpenAIMessage {
	role: 'system' | 'user' | 'assistant';
	content: string | OpenAIContentItem[];
}

export interface ChatCompletionsBody {
	model?: string;
	messages: OpenAIMessage[];
	stream?: boolean;
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	presence_penalty?: number;
	frequency_penalty?: number;
	seed?: number;
}

export interface UpstreamChatCreate {
	model: string;
	messages: { role: string; content: string }[];
	stream?: boolean;
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	presence_penalty?: number;
	frequency_penalty?: number;
	seed?: number;
}

export interface ChatCompletionResponse {
	id: string;
	object: 'chat.completion';
	created: number;
	model: string;
	choices: Array<{
		index: number;
		message: {
			role: string;
			content: string;
		};
		finish_reason: string;
	}>;
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

export interface ChatCompletionChunk {
	id: string;
	object: 'chat.completion.chunk';
	created: number;
	model: string;
	choices: Array<{
		index: number;
		delta: {
			content?: string;
		};
		finish_reason: string | null;
	}>;
}

export interface ModelsResponse {
	object: 'list';
	data: Model[];
}

export interface Model {
	id: string;
	object: 'model';
	created: number;
	owned_by: string;
}
