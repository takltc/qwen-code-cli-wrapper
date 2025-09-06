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

export type OpenAIRole = 'system' | 'user' | 'assistant' | 'tool' | 'function';

export interface OpenAIMessage {
    role: OpenAIRole;
    content: string | OpenAIContentItem[];
    name?: string; // for tool/function result messages
    tool_call_id?: string; // compatibility field (not used in mapper)
    // Allow assistant messages to include tool_calls (OpenAI-compatible)
    tool_calls?: AssistantToolCall[];
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

	// Tool support (OpenAI-compatible shape)
	tools?: Tool[];
	tool_choice?: ToolChoice;
}

export interface UpstreamChatCreate {
    model: string;
    messages: { role: string; content: string | OpenAIContentItem[] }[];
    stream?: boolean;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
    seed?: number;
    // OpenAI-compatible tool support for upstream
    tools?: Tool[];
    tool_choice?: ToolChoice;
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
            content: string | null;
            tool_calls?: AssistantToolCall[];
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
            role?: string;
            tool_calls?: Array<AssistantToolCall & { index: number }>;
        };
        finish_reason: string | null;
    }>;
    usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
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

// Tools (OpenAI-compatible)
export interface FunctionToolSchema {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>; // JSONSchema-like
}

export interface FunctionTool {
	type: 'function';
	function: FunctionToolSchema;
}

export type Tool = FunctionTool; // currently only function tools supported

export type ToolChoice =
    | 'none'
    | 'auto'
    | 'required'
    | { type: 'function'; function: { name: string } };

// Assistant tool call (OpenAI-compatible)
export interface AssistantToolCall {
    id?: string;
    type: 'function';
    function: { name: string; arguments: string };
}
