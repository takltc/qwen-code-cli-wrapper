/**
 * Request validation schemas with strong typing
 */

import type { ChatCompletionsBody, OpenAIMessage } from '../types/openai';

// Raw request body type for validation
interface RawChatRequest {
	model?: unknown;
	messages?: unknown;
	stream?: unknown;
	temperature?: unknown;
	top_p?: unknown;
	max_tokens?: unknown;
	presence_penalty?: unknown;
	frequency_penalty?: unknown;
	seed?: unknown;
}

// Type guard to check if value is a plain object
function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Type guard for message object
function isValidMessage(value: unknown): value is OpenAIMessage {
	if (!isObject(value)) return false;
	if (!('role' in value) || !('content' in value)) return false;

	const role = value.role;
	const content = value.content;

	// Validate role
	if (typeof role !== 'string' || !['system', 'user', 'assistant'].includes(role)) {
		return false;
	}

	// Handle different content types
	if (typeof content === 'string') {
		// Simple string content
		return content.trim().length > 0;
	} else if (Array.isArray(content)) {
		// Array of content objects (for multimodal messages)
		return content.length > 0 && content.every((item) => {
			if (!isObject(item)) return false;
			if (!('type' in item)) return false;
			
			const type = item.type;
			if (typeof type !== 'string') return false;
			
			// Handle text content
			if (type === 'text') {
				return 'text' in item && typeof item.text === 'string' && item.text.trim().length > 0;
			}
			
			// Handle image content (if supported)
			if (type === 'image_url') {
				return 'image_url' in item && isObject(item.image_url) && 'url' in item.image_url;
			}
			
			// Allow other content types to pass through
			return true;
		});
	}

	return false;
}

function validateOptionalNumber(value: unknown, fieldName: string, min?: number, max?: number): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'number') {
		throw new Error(`${fieldName} must be a number`);
	}
	if (min !== undefined && value < min) {
		throw new Error(`${fieldName} must be >= ${min}`);
	}
	if (max !== undefined && value > max) {
		throw new Error(`${fieldName} must be <= ${max}`);
	}
	return value;
}

function validateOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'boolean') {
		throw new Error(`${fieldName} must be a boolean`);
	}
	return value;
}

export function validateChatBody(body: unknown): ChatCompletionsBody {
	if (!isObject(body)) {
		throw new Error('Request body must be a JSON object');
	}

	const rawBody = body as RawChatRequest;

	// Validate messages array
	if (!Array.isArray(rawBody.messages) || rawBody.messages.length === 0) {
		throw new Error('messages must be a non-empty array');
	}

	// Validate each message
	const validatedMessages: OpenAIMessage[] = [];
	for (let i = 0; i < rawBody.messages.length; i++) {
		const message = rawBody.messages[i];
		if (!isValidMessage(message)) {
			throw new Error(`Message at index ${i} is invalid: must have valid role (system|user|assistant) and non-empty content. Received: ${JSON.stringify(message)}`);
		}
		validatedMessages.push(message);
	}

	// Validate optional fields
	const stream = validateOptionalBoolean(rawBody.stream, 'stream');
	const temperature = validateOptionalNumber(rawBody.temperature, 'temperature', 0, 2);
	const topP = validateOptionalNumber(rawBody.top_p, 'top_p', 0, 1);
	const maxTokens = validateOptionalNumber(rawBody.max_tokens, 'max_tokens', 1);
	const presencePenalty = validateOptionalNumber(rawBody.presence_penalty, 'presence_penalty', -2, 2);
	const frequencyPenalty = validateOptionalNumber(rawBody.frequency_penalty, 'frequency_penalty', -2, 2);

	// Build validated result
	const result: ChatCompletionsBody = {
		messages: validatedMessages,
	};

	if (stream !== undefined) result.stream = stream;
	if (temperature !== undefined) result.temperature = temperature;
	if (topP !== undefined) result.top_p = topP;
	if (maxTokens !== undefined) result.max_tokens = maxTokens;
	if (presencePenalty !== undefined) result.presence_penalty = presencePenalty;
	if (frequencyPenalty !== undefined) result.frequency_penalty = frequencyPenalty;

	return result;
}

export function validateModel(model?: string): string {
	if (!model) {
		return 'qwen3-coder-plus'; // Default fallback
	}

	// Add more validation logic here if needed
	return model;
}
