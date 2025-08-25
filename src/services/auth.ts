/**
 * Authentication service for API key validation
 */

import type { Bindings } from '../types/bindings';

export class AuthService {
	constructor(private env: Bindings) {}

	/**
	 * Validate API key from Authorization header
	 * @param authHeader The Authorization header value
	 * @returns true if valid, false otherwise
	 */
	validateApiKey(authHeader?: string): boolean {
		console.log('AuthService.validateApiKey called with header:', authHeader ? 'present' : 'missing');

		if (!this.env.OPENAI_API_KEY) {
			// If no API key is configured, allow all requests (for development)
			console.log('No OPENAI_API_KEY configured, allowing request');
			return true;
		}

		if (!authHeader) {
			console.log('No Authorization header provided');
			return false;
		}

		const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
		if (!bearerMatch) {
			console.log('Invalid Authorization header format, expected "Bearer <token>"');
			return false;
		}

		const providedKey = bearerMatch[1];
		const expectedKey = this.env.OPENAI_API_KEY;

		console.log('Comparing API keys:', {
			providedLength: providedKey.length,
			expectedLength: expectedKey.length,
			match: providedKey === expectedKey,
		});

		if (providedKey !== expectedKey) {
			console.log('API key mismatch - access denied');
			return false;
		}

		console.log('API key validation successful');
		return true;
	}

	/**
	 * Extract API key from Authorization header (for logging/debugging)
	 * @param authHeader The Authorization header value
	 * @returns The API key if present, undefined otherwise
	 */
	extractApiKey(authHeader?: string): string | undefined {
		if (!authHeader) return undefined;

		const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
		return bearerMatch ? bearerMatch[1] : undefined;
	}

	/**
	 * Check if authentication is required (API key is configured)
	 * @returns true if API key authentication is required
	 */
	isAuthRequired(): boolean {
		return !!this.env.OPENAI_API_KEY;
	}
}
