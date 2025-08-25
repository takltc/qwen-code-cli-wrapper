import type { Hono } from 'hono';
import { QwenOAuthKvClient } from '../services/qwenOAuthKvClient';
import { toUpstreamPayload } from '../services/openaiMapper';
import { chatCompletions, resolveBaseUrl } from '../services/qwenProxy';
import { validateChatBody } from '../config/validation';
import { KV_CREDENTIALS_KEY } from '../services/credentials';
import { AuthService } from '../services/auth';

export function registerChatRoutes<E extends Record<string, unknown>>(app: Hono<E>) {
	app.post('/v1/chat/completions', async (c) => {
		console.log('=== New chat completion request ===');

		try {
			const env = c.env as {
				QWEN_KV: KVNamespace;
				QWEN_CLI_AUTH?: string;
				OPENAI_MODEL?: string;
				OPENAI_BASE_URL?: string;
				OPENAI_API_KEY?: string;
			};

			console.log('Environment loaded:', {
				hasKv: !!env.QWEN_KV,
				hasCliAuth: !!env.QWEN_CLI_AUTH,
				openaiModel: env.OPENAI_MODEL,
				hasApiKey: !!env.OPENAI_API_KEY,
			});

			// --- API Key Authentication ---
			const authService = new AuthService(env);
			const authHeader = c.req.header('Authorization');

			console.log('Auth check:', {
				authRequired: authService.isAuthRequired(),
				hasAuthHeader: !!authHeader,
			});

			if (authService.isAuthRequired() && !authService.validateApiKey(authHeader)) {
				console.log('API key authentication failed');
				return c.json({ error: { message: 'Invalid or missing API key. Please provide a valid Authorization header.' } }, 401);
			}

			console.log('Authentication passed');

			// Load/ensure credentials
			const oauth = new QwenOAuthKvClient(env.QWEN_KV);
			// best-effort bootstrap (no-op if already in KV)
			const existing = await env.QWEN_KV.get(KV_CREDENTIALS_KEY);
			if (!existing && env.QWEN_CLI_AUTH) {
				await oauth.loadInitialCredentials(env.QWEN_CLI_AUTH);
			}

			console.log('Parsing request body...');
			const rawBody = await c.req.json();
			console.log('Request body:', JSON.stringify(rawBody, null, 2));

			console.log('Validating request...');
			const body = validateChatBody(rawBody);
			console.log('Request validation passed');

			const model = body.model || env.OPENAI_MODEL || 'qwen3-coder-plus';
			console.log('Using model:', model);

			const payload = toUpstreamPayload(body, model);
			console.log('Payload prepared:', JSON.stringify(payload, null, 2));

			console.log('Getting OAuth token...');
			const { token, creds } = await oauth.getValidAccessToken();
			console.log('Token obtained:', !!token);

			if (!token) {
				console.log('No valid token available');
				return c.json({ error: { message: 'No valid Qwen OAuth token. Provide QWEN_CLI_AUTH or re-authenticate.' } }, 401);
			}

			const baseUrl = resolveBaseUrl(creds || undefined, env.OPENAI_BASE_URL);
			console.log('Base URL resolved:', baseUrl);

			const reqId = c.req.header('x-request-id') || crypto.randomUUID();
			console.log('Request ID:', reqId);

			console.log('Making upstream request...');
			const upstream = await chatCompletions(baseUrl, token, payload, reqId);
			console.log('Upstream response received, status:', upstream.status);

			if (payload.stream) {
				// Process upstream SSE stream with deduplication and usage handling
				c.header('Content-Type', 'text/event-stream');
				c.header('Cache-Control', 'no-cache');
				c.header('Connection', 'keep-alive');

				const body = upstream.body;
				if (!body) return c.body('[DONE]');

				const reader = body.getReader();
				const encoder = new TextEncoder();
				const decoder = new TextDecoder();
				let buffer = '';
				let lastContent = ''; // Track last content to detect duplicates
				let usage: any = null; // Capture usage information

				const respStream = new ReadableStream({
					async start(controller) {
						try {
							while (true) {
								const { value, done } = await reader.read();
								if (done) break;

								// Decode chunk and add to buffer
								buffer += decoder.decode(value, { stream: true });

								// Process complete SSE lines
								const lines = buffer.split('\n');
								buffer = lines.pop() || ''; // Keep incomplete line in buffer

								for (const line of lines) {
									if (line.startsWith('data: ')) {
										const data = line.slice(6); // Remove 'data: ' prefix

										// Skip empty data or [DONE]
										if (data.trim() === '' || data.trim() === '[DONE]') {
											continue;
										}

										try {
											// Parse JSON to ensure it's valid
											const chunk = JSON.parse(data);

											// Capture usage information if present (some providers send it in chunks)
											if (chunk.usage) {
												usage = chunk.usage;
												console.log('Captured usage in stream:', usage);
											}

											// Handle content deduplication for streaming chunks
											if (chunk.choices && chunk.choices.length > 0) {
												const choice = chunk.choices[0];

												// Filter out empty delta chunks
												if (choice.delta && Object.keys(choice.delta).length === 0) {
													continue;
												}

												// Check for content duplication in delta
												if (choice.delta && choice.delta.content) {
													const currentContent = choice.delta.content;

													// If this content starts with the same text as the last content,
													// it might be a duplication - remove the duplicate prefix
													if (lastContent && currentContent.startsWith(lastContent)) {
														const deduplicatedContent = currentContent.slice(lastContent.length);
														if (deduplicatedContent) {
															choice.delta.content = deduplicatedContent;
															lastContent = deduplicatedContent;
														} else {
															// Skip if it was entirely duplicate
															continue;
														}
													} else {
														lastContent = currentContent;
													}
												}

												// If this is the final chunk (finish_reason is set), attach usage
												if (choice.finish_reason && usage) {
													chunk.usage = usage;
													console.log('Attached usage to final chunk:', chunk.usage);
												}
											}

											// Re-encode and send
											controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
										} catch (_e) {
											// If JSON parsing fails, skip this chunk
											console.warn('Skipping malformed chunk:', data);
											continue;
										}
									} else if (line.trim()) {
										// Forward non-data lines (like comments)
										controller.enqueue(encoder.encode(line + '\n'));
									}
								}
							}

							// Process any remaining buffer content
							if (buffer.trim()) {
								const lines = buffer.split('\n');
								for (const line of lines) {
									if (line.startsWith('data: ')) {
										const data = line.slice(6);
										if (data.trim() && data.trim() !== '[DONE]') {
											try {
												const chunk = JSON.parse(data);

												// Attach usage to final chunk if we have it
												if (usage && chunk.choices && chunk.choices[0]?.finish_reason) {
													chunk.usage = usage;
													console.log('Attached usage to final buffered chunk:', chunk.usage);
												}

												controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
											} catch (e) {
												// Skip malformed final chunk
											}
										}
									}
								}
							}

							// Send final done marker
							controller.enqueue(encoder.encode('data: [DONE]\n\n'));
						} catch (error) {
							console.error('Stream processing error:', error);
						} finally {
							controller.close();
						}
					},
				});

				return new Response(respStream, {
					headers: {
						'Content-Type': 'text/event-stream',
						'Cache-Control': 'no-cache',
						Connection: 'keep-alive',
					},
				});
			} else {
				// Non-stream JSON passthrough
				const json = await upstream.json();
				console.log(
					'Non-stream response usage:',
					json && typeof json === 'object' && 'usage' in json ? (json as Record<string, unknown>).usage : 'N/A',
				);
				// It should already be OpenAI-compatible structure
				return c.json(json as Record<string, unknown>);
			}
		} catch (err: any) {
			const msg = err?.message || 'Unknown error';
			return c.json({ error: { message: msg } }, 500);
		}
	});
}
