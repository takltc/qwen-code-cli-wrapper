import type { OpenAIMessage, Tool, ToolChoice, OpenAITextContent, AssistantToolCall, FunctionTool, FunctionToolSchema } from '../types/openai';

function isTextItem(obj: unknown): obj is OpenAITextContent {
	return (
		typeof obj === 'object' &&
		obj !== null &&
		(obj as { type?: unknown }).type === 'text' &&
		typeof (obj as { text?: unknown }).text === 'string'
	);
}

export function contentToString(content: unknown): string {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const p of content as unknown[]) {
			if (typeof p === 'string') {
				parts.push(p);
				continue;
			}
			if (isTextItem(p)) parts.push(p.text);
		}
		return parts.join(' ');
	}
	return '';
}

export function generateToolPrompt(tools: Tool[]): string {
	if (!tools || tools.length === 0) return '';

	const sections: string[] = [];
	for (const tool of tools) {
		if (tool.type !== 'function') continue;
		const fn: FunctionToolSchema = (tool as FunctionTool).function;
		const name = fn.name || 'unknown';
		const desc = fn.description || '';
		const parameters = (fn.parameters || {}) as Record<string, unknown>;

		const block: string[] = [];
		block.push(`## ${name}`);
		block.push(`**Purpose**: ${desc}`);

		const props = (parameters as { properties?: Record<string, { type?: string; description?: string }> }).properties || {};
		const required = new Set<string>(Array.isArray((fn as { parameters?: { required?: string[] } }).parameters?.required) ? (fn as { parameters?: { required?: string[] } }).parameters!.required! : []);
		const keys = Object.keys(props);
		if (keys.length) {
			block.push('**Parameters**:');
			for (const paramName of keys) {
				const pd = props[paramName] || {};
				const t = pd.type || 'any';
				const d = pd.description || '';
				const flag = required.has(paramName) ? '**Required**' : '*Optional*';
				block.push(`- \`${paramName}\` (${t}) - ${flag}: ${d}`);
			}
		}
		sections.push(block.join('\n'));
	}

	if (sections.length === 0) return '';

	const instructions =
		"\n\n# AVAILABLE FUNCTIONS\n" +
		sections.join('\n\n---\n') +
		"\n\n# TOOL USAGE GUIDELINES\n" +
		"- Call a tool only when an external action is required.\n" +
		"- Keep calls minimal and specific to the user request.\n";

	return instructions;
}

export function processMessagesWithTools(messages: OpenAIMessage[], tools?: Tool[], toolChoice?: ToolChoice): OpenAIMessage[] {
	// Always normalize content on copy
	const copied = messages.map((m) => ({ ...m, content: contentToString(m.content) }));

	if (!tools || tools.length === 0 || toolChoice === 'none') {
		return copied;
	}

	const toolPrompt = generateToolPrompt(tools);

	// Inject prompt only into the first system message (or create one at the top). Preserve all messages.
	let injected = false;
	const out: OpenAIMessage[] = [];
	for (const m of copied) {
		if (!injected && m.role === 'system') {
			const base = contentToString(m.content);
			out.push({ ...m, content: `${base}${toolPrompt}` });
			injected = true;
			continue;
		}
		out.push(m);
	}
	if (!injected) {
		out.unshift({ role: 'system', content: `你是一个有用的助手。${toolPrompt}` } as OpenAIMessage);
	}

	return out;
}

// Regex helpers
const TOOL_CALL_FENCE_PATTERN = /```json\s*(\{[\s\S]*?\})\s*```/g;
const FUNCTION_CALL_PATTERN = /调用函数\s*[：:]\s*([\w\-.]+)\s*(?:参数|arguments)[：:]\s*(\{[\s\S]*?\})/;

type ParsedMaybeToolCalls = { tool_calls?: unknown };

export type ToolCall = { id?: string; type: 'function'; function: { name: string; arguments: string } };

// Global counter for generating unique IDs
let toolCallCounter = 0;

export function extractToolInvocations(text: string | undefined | null): ToolCall[] | null {
	if (!text) return null;
	const scannable = String(text).slice(0, 100_000);

	// Attempt 1: fenced JSON blocks — take the LAST block containing tool_calls
	let m: RegExpExecArray | null;
	TOOL_CALL_FENCE_PATTERN.lastIndex = 0;
	let lastFenced: ToolCall[] | null = null;
	while ((m = TOOL_CALL_FENCE_PATTERN.exec(scannable))) {
		try {
			const parsed = JSON.parse(m[1]) as ParsedMaybeToolCalls;
			const toolCalls = parsed?.tool_calls;
			if (Array.isArray(toolCalls) && toolCalls.length) {
				lastFenced = toolCalls.map((tc: unknown) => normalizeToolCall(tc));
			}
		} catch {}
	}
	if (lastFenced) return lastFenced;

	// Attempt 2: inline JSON objects with brace balance
	const found = scanInlineJsonForToolCalls(scannable);
	if (found) return found;

	// Attempt 3: natural language pattern
	const n = FUNCTION_CALL_PATTERN.exec(scannable);
	if (n) {
		const name = n[1]?.trim();
		const argsStr = n[2]?.trim();
		try {
			JSON.parse(argsStr);
			// Use a more unique ID generation method
			const uniqueId = `call_${Date.now()}_${toolCallCounter++}`;
			return [{ id: uniqueId, type: 'function', function: { name, arguments: argsStr } }];
		} catch {}
	}

	return null;
}

function normalizeToolCall(tc: unknown): ToolCall {
	const obj = (typeof tc === 'object' && tc !== null ? (tc as Record<string, unknown>) : {}) as Record<string, unknown>;
	const rawFn = (obj.function && typeof obj.function === 'object' ? (obj.function as Record<string, unknown>) : undefined);
	let name: string | undefined;
	let args: unknown;

	if (rawFn) {
		name = typeof rawFn.name === 'string' ? rawFn.name : undefined;
		args = rawFn.arguments;
	} else {
		// Fallback to top-level fields if model omitted `function:{}` wrapper
		name = typeof obj.name === 'string' ? obj.name : undefined;
		args = obj.arguments;
	}

	let finalArgs: string;
	if (typeof args === 'string') {
		finalArgs = args || '{}';
	} else {
		try {
			finalArgs = JSON.stringify(args ?? {});
		} catch {
			finalArgs = String(args ?? '{}');
		}
	}
	if (!name) name = 'unknown';

	return {
		id: typeof obj.id === 'string' ? obj.id : undefined,
		type: 'function',
		function: {
			name,
			arguments: finalArgs,
		},
	};
}

function scanInlineJsonForToolCalls(text: string): ToolCall[] | null {
	let i = 0;
	const len = text.length;
	let last: ToolCall[] | null = null;
	while (i < len) {
		if (text[i] === '{') {
			let j = i + 1;
			let brace = 1;
			let inStr = false;
			let esc = false;
			while (j < len && brace > 0) {
				const ch = text[j];
				if (esc) {
					esc = false;
				} else if (ch === '\\') {
					esc = true;
				} else if (ch === '"') {
					inStr = !inStr;
				} else if (!inStr) {
					if (ch === '{') brace++;
					else if (ch === '}') brace--;
				}
				j++;
			}
			if (brace === 0) {
				const jsonStr = text.slice(i, j);
				try {
					const parsed = JSON.parse(jsonStr) as ParsedMaybeToolCalls;
					if (parsed && Array.isArray(parsed.tool_calls)) {
						last = parsed.tool_calls.map((tc: unknown) => normalizeToolCall(tc));
					}
				} catch {}
			}
			i++;
		} else {
			i++;
		}
	}
	return last;
}

export function removeToolJsonContent(text: string): string {
	if (!text) return '';
	// Remove fenced tool JSON blocks that contain tool_calls
	const cleanedFenced = text.replace(TOOL_CALL_FENCE_PATTERN, (match, grp) => {
		try {
			const parsed = JSON.parse(grp) as unknown;
			if (parsed && typeof parsed === 'object' && parsed !== null && 'tool_calls' in (parsed as Record<string, unknown>)) return '';
		} catch {}
		return match;
	});

	// Remove inline tool JSON blocks (brace-balance based)
	let result = '';
	let i = 0;
	while (i < cleanedFenced.length) {
		if (cleanedFenced[i] === '{') {
			let j = i + 1;
			let brace = 1;
			let inStr = false;
			let esc = false;
			while (j < cleanedFenced.length && brace > 0) {
				const ch = cleanedFenced[j];
				if (esc) {
					esc = false;
				} else if (ch === '\\') {
					esc = true;
				} else if (ch === '"') {
					inStr = !inStr;
				} else if (!inStr) {
					if (ch === '{') brace++;
					else if (ch === '}') brace--;
				}
				j++;
			}
			if (brace === 0) {
				const jsonStr = cleanedFenced.slice(i, j);
				try {
					const parsed = JSON.parse(jsonStr) as unknown;
					if (parsed && typeof parsed === 'object' && parsed !== null && 'tool_calls' in (parsed as Record<string, unknown>)) {
						i = j; // skip this block
						continue;
					}
				} catch {}
			}
			// not a tool_calls block or parse failed; keep char
			result += cleanedFenced[i];
			i++;
		} else {
			result += cleanedFenced[i];
			i++;
		}
	}
	return result.trim();
}

export function sanitizeToolCalls(calls: ToolCall[]): ToolCall[] {
	// Align with Qwen Code: do not enforce schema filtering or drop calls.
	// Only normalize function wrapper and ensure arguments is a JSON string when possible.
	return calls.map((tc) => normalizeToolCall(tc));
}

/**
 * Clean orphaned tool calls from message history (aligned with qwen-code core)
 *
 * Rationale (qwen-code/packages/core/src/core/openaiContentGenerator.ts):
 * - Collect assistant.tool_calls and tool.tool_call_id
 * - Remove assistant.tool_calls without matching tool responses
 * - Keep assistant text content when present, but drop invalid tool_calls
 * - Only keep tool responses that correspond to an existing tool_call id
 * - Final validation pass to ensure all remaining tool_calls have responses
 */
export function cleanOrphanedToolCalls(messages: OpenAIMessage[]): OpenAIMessage[] {
	const toolCallIds = new Set<string>();
	const toolResponseIds = new Set<string>();

	for (const m of messages) {
		if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
			for (const tc of m.tool_calls) {
				if (tc?.id) toolCallIds.add(String(tc.id));
			}
		} else if (m.role === 'tool' && typeof m.tool_call_id === 'string' && m.tool_call_id.length > 0) {
			toolResponseIds.add(m.tool_call_id);
		}
	}

	const cleaned: OpenAIMessage[] = [];
	for (const m of messages) {
		if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
			const toolCalls = (m.tool_calls as AssistantToolCall[]).filter((tc) => tc?.id && toolResponseIds.has(String(tc.id)));
			const content = contentToString(m.content);
			if (toolCalls.length > 0) {
				const copy: OpenAIMessage = { ...m };
				(copy as { tool_calls?: AssistantToolCall[] }).tool_calls = toolCalls;
				cleaned.push(copy);
			} else if (content && content.trim()) {
				const copy: OpenAIMessage = { ...m };
				if ('tool_calls' in copy) delete (copy as { tool_calls?: AssistantToolCall[] }).tool_calls;
				copy.content = content;
				cleaned.push(copy);
			}
		} else if (m.role === 'tool' && typeof m.tool_call_id === 'string' && m.tool_call_id.length > 0) {
			const id = m.tool_call_id;
			if (toolCallIds.has(id)) cleaned.push(m);
		} else {
			cleaned.push(m);
		}
	}

	const finalToolResponseIds = new Set<string>();
	for (const m of cleaned) {
		if (m.role === 'tool' && typeof m.tool_call_id === 'string' && m.tool_call_id.length > 0) finalToolResponseIds.add(m.tool_call_id);
	}
	const final: OpenAIMessage[] = [];
	for (const m of cleaned) {
		if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
			const tcs = (m.tool_calls as AssistantToolCall[]).filter((tc) => tc?.id && finalToolResponseIds.has(String(tc.id)));
			if (tcs.length > 0) {
				const copy: OpenAIMessage = { ...m };
				(copy as { tool_calls?: AssistantToolCall[] }).tool_calls = tcs;
				final.push(copy);
			} else {
				const content = contentToString(m.content);
				if (content && content.trim()) {
					const copy: OpenAIMessage = { ...m };
					if ('tool_calls' in copy) delete (copy as { tool_calls?: AssistantToolCall[] }).tool_calls;
					copy.content = content;
					final.push(copy);
				}
			}
		} else {
			final.push(m);
		}
	}

	return final;
}

// Ensure every tool message immediately follows the assistant message that requested it
function reorderToolMessages(messages: OpenAIMessage[]): OpenAIMessage[] {
	const result: OpenAIMessage[] = [];
	const consumed = new Set<number>();
	for (let i = 0; i < messages.length; i++) {
		const m = messages[i];
		if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
			result.push(m);
			const ids = new Set<string>();
			for (const tc of m.tool_calls) if (tc?.id) ids.add(String(tc.id));
			// Pull matching tool messages that occur after this assistant until the next assistant
			for (let j = i + 1; j < messages.length; j++) {
				if (consumed.has(j)) continue;
				const n = messages[j];
				if (n.role === 'assistant') break;
				if (n.role === 'tool' && typeof n.tool_call_id === 'string' && ids.has(n.tool_call_id)) {
					result.push(n);
					consumed.add(j);
				}
			}
			continue;
		}
		if (m.role === 'tool') {
			// Stray tool message (no immediately preceding assistant with tool_calls) is dropped
			continue;
		}
		result.push(m);
	}
	return result;
}

/**
 * Merge consecutive assistant messages (aligned with qwen-code core)
 * - Concatenate contents
 * - Concatenate tool_calls arrays
 */
export function mergeConsecutiveAssistantMessages(messages: OpenAIMessage[]): OpenAIMessage[] {
	const merged: OpenAIMessage[] = [];
	for (const m of messages) {
		if (m.role === 'assistant' && merged.length > 0 && merged[merged.length - 1].role === 'assistant') {
			const last = merged[merged.length - 1] as OpenAIMessage;
			const prevContent = contentToString(last.content);
			const curContent = contentToString(m.content);
			last.content = [prevContent, curContent].filter(Boolean).join('');
			const lastCalls = Array.isArray(last.tool_calls) ? last.tool_calls : [];
			const curCalls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
			const combined = [...lastCalls, ...curCalls];
			if (combined.length > 0) (last as { tool_calls?: AssistantToolCall[] }).tool_calls = combined;
			continue;
		}
		merged.push(m);
	}
	return merged;
}

/**
 * Preprocess messages before upstream: clean orphaned tool calls, merge consecutive assistant messages, reorder tools
 */
export function preprocessMessagesForUpstream(messages: OpenAIMessage[]): OpenAIMessage[] {
	const cleaned = cleanOrphanedToolCalls(messages);
	const merged = mergeConsecutiveAssistantMessages(cleaned);
	const ordered = reorderToolMessages(merged);
	// Removed tool call deduplication to align with Qwen Code implementation
	// Qwen Code does not implement session-level tool call deduplication
	return ordered;
}
