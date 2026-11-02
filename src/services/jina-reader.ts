/**
 * Jina Reader API Service
 * Handles article content extraction using Jina Reader (https://r.jina.ai/).
 * Strictly independent of Supabase — responsible only for URL security validation,
 * HTTP interaction with Jina Reader, content metric calculations, and safe response parsing.
 */

export const JINA_READER_API_URL = "https://r.jina.ai/";

export interface JinaExtractedData {
	url?: string;
	title?: string;
	content?: string;
	description?: string;
	timestamp?: string;
	publishedTime?: string;
}

export interface JinaExtractionSuccess {
	success: true;
	extracted_title?: string;
	extracted_url?: string;
	content: string;
	content_length: number;
	paragraph_count: number;
	format: "markdown";
	extracted_at: string;
}

export interface JinaExtractionFailure {
	success: false;
	status: number;
	error: string;
	details?: string;
}

export type JinaExtractionOutcome = JinaExtractionSuccess | JinaExtractionFailure;

/**
 * Validates an IPv4 address (as 4 octets) against loopback, private, link-local, and zero ranges.
 * Returns an error description if prohibited, or null if permitted.
 */
export function checkProhibitedIPv4(octets: number[]): string | null {
	if (octets.length !== 4 || octets.some((o) => isNaN(o) || o < 0 || o > 255)) {
		return "Malformed IPv4 address";
	}
	// 0.0.0.0/8 (current network)
	if (octets[0] === 0) {
		return "Zero/unspecified IPv4 addresses are prohibited";
	}
	// 127.0.0.0/8 (loopback)
	if (octets[0] === 127) {
		return "Loopback IPv4 addresses are prohibited";
	}
	// 10.0.0.0/8 (private)
	if (octets[0] === 10) {
		return "Private IPv4 addresses (10.0.0.0/8) are prohibited";
	}
	// 172.16.0.0/12 (private: 172.16.x.x - 172.31.x.x)
	if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
		return "Private IPv4 addresses (172.16.0.0/12) are prohibited";
	}
	// 192.168.0.0/16 (private)
	if (octets[0] === 192 && octets[1] === 168) {
		return "Private IPv4 addresses (192.168.0.0/16) are prohibited";
	}
	// 169.254.0.0/16 (link-local)
	if (octets[0] === 169 && octets[1] === 254) {
		return "Link-local IPv4 addresses (169.254.0.0/16) are prohibited";
	}
	return null;
}

/**
 * Parses an IPv6 address string into an array of 8 16-bit unsigned integers (hextets).
 * Supports standard hextets, :: abbreviation, and IPv4-mapped or embedded tail formats.
 * Returns null if the string is not a valid IPv6 literal.
 */
export function parseIPv6(ipStr: string): number[] | null {
	if (!ipStr || typeof ipStr !== "string") return null;
	const clean = ipStr.trim().toLowerCase();
	if (clean.includes("%")) return null; // Zone indices prohibited in URL hostname literals
	const doubleColonCount = clean.split("::").length - 1;
	if (doubleColonCount > 1) return null;

	let leftPart = clean;
	let rightPart: string | null = null;
	if (doubleColonCount === 1) {
		const parts = clean.split("::");
		leftPart = parts[0];
		rightPart = parts[1];
	}

	const parseHextets = (part: string): number[] | null => {
		if (!part) return [];
		const tokens = part.split(":");
		const hextets: number[] = [];
		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			if (token.includes(".")) {
				if (i !== tokens.length - 1) return null; // Dotted-decimal must be at the end
				const ipv4Octets = token.split(".").map(Number);
				if (ipv4Octets.length !== 4 || ipv4Octets.some((o) => isNaN(o) || o < 0 || o > 255)) return null;
				hextets.push((ipv4Octets[0] << 8) | ipv4Octets[1]);
				hextets.push((ipv4Octets[2] << 8) | ipv4Octets[3]);
			} else {
				if (!/^[0-9a-f]{1,4}$/.test(token)) return null;
				hextets.push(parseInt(token, 16));
			}
		}
		return hextets;
	};

	const leftHextets = parseHextets(leftPart);
	if (leftHextets === null) return null;

	if (rightPart === null) {
		if (leftHextets.length !== 8) return null;
		return leftHextets;
	}

	const rightHextets = parseHextets(rightPart);
	if (rightHextets === null) return null;

	const totalSpecified = leftHextets.length + rightHextets.length;
	if (totalSpecified > 7) return null;

	const zerosNeeded = 8 - totalSpecified;
	const zeros = new Array<number>(zerosNeeded).fill(0);
	return [...leftHextets, ...zeros, ...rightHextets];
}

/**
 * Validates an article URL for security before passing to Jina Reader.
 * Rejects non-HTTP/HTTPS protocols, embedded credentials, localhost, internal domains,
 * IPv4 loopback / private / link-local / unspecified ranges, and full IPv6 CIDR ranges
 * (loopback ::1, unspecified ::, link-local fe80::/10, unique-local fc00::/7, IPv4-mapped).
 */
export function validateArticleUrl(rawUrl: string): { valid: true; parsedUrl: URL } | { valid: false; error: string } {
	if (typeof rawUrl !== "string" || !rawUrl.trim()) {
		return { valid: false, error: "Missing or empty article URL" };
	}

	let parsed: URL;
	try {
		parsed = new URL(rawUrl.trim());
	} catch {
		return { valid: false, error: "Malformed URL: failed to parse" };
	}

	// Protocol check: only http: and https:
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return {
			valid: false,
			error: `Unsupported URL protocol: "${parsed.protocol}". Only HTTP and HTTPS are permitted.`,
		};
	}

	// Reject embedded credentials
	if (parsed.username || parsed.password) {
		return {
			valid: false,
			error: "Embedded credentials (username/password) are not permitted in URLs",
		};
	}

	const hostname = parsed.hostname.toLowerCase();

	// Reject localhost / internal domain names
	if (
		hostname === "localhost" ||
		hostname.endsWith(".localhost") ||
		hostname.endsWith(".local") ||
		hostname.endsWith(".internal") ||
		hostname.endsWith(".lan")
	) {
		return {
			valid: false,
			error: `Invalid hostname "${hostname}": local and internal domains are prohibited`,
		};
	}

	// Check IPv4 loopback / private / link-local / unspecified
	const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
	if (ipv4Match) {
		const octets = [
			Number(ipv4Match[1]),
			Number(ipv4Match[2]),
			Number(ipv4Match[3]),
			Number(ipv4Match[4]),
		];

		const ipv4Err = checkProhibitedIPv4(octets);
		if (ipv4Err) {
			return { valid: false, error: ipv4Err };
		}
	}

	// Check IPv6 (in URLs, IPv6 hostnames are enclosed in brackets e.g. [::1])
	const isIPv6Bracketed = hostname.startsWith("[") && hostname.endsWith("]");
	if (isIPv6Bracketed) {
		const cleanHostname = hostname.slice(1, -1);
		const hextets = parseIPv6(cleanHostname);

		if (!hextets) {
			return { valid: false, error: `Malformed or ambiguous IPv6 literal: ${cleanHostname}` };
		}

		// 1. Loopback (::1)
		const isLoopback = hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 1;
		if (isLoopback) {
			return { valid: false, error: "Loopback IPv6 addresses (::1) are prohibited" };
		}

		// 2. Unspecified (::)
		const isUnspecified = hextets.every((h) => h === 0);
		if (isUnspecified) {
			return { valid: false, error: "Zero/unspecified IPv6 addresses (::) are prohibited" };
		}

		// 3. Link-local (fe80::/10 -> first hextet 0xfe80 - 0xfebf)
		if ((hextets[0] & 0xffc0) === 0xfe80) {
			return { valid: false, error: "Link-local IPv6 addresses (fe80::/10) are prohibited" };
		}

		// 4. Unique-local / Private (fc00::/7 -> first hextet 0xfc00 - 0xfdff)
		if ((hextets[0] & 0xfe00) === 0xfc00) {
			return { valid: false, error: "Private/unique-local IPv6 addresses (fc00::/7) are prohibited" };
		}

		// 5. Site-local (fec0::/10 -> first hextet 0xfec0 - 0xfeff, deprecated RFC 3879)
		if ((hextets[0] & 0xffc0) === 0xfec0) {
			return { valid: false, error: "Site-local IPv6 addresses (fec0::/10) are prohibited" };
		}

		// 6. IPv4-mapped IPv6 (::ffff:0:0/96)
		const isIPv4Mapped = hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff;
		if (isIPv4Mapped) {
			const mappedOctets = [
				(hextets[6] >> 8) & 0xff,
				hextets[6] & 0xff,
				(hextets[7] >> 8) & 0xff,
				hextets[7] & 0xff,
			];
			const mappedErr = checkProhibitedIPv4(mappedOctets);
			if (mappedErr) {
				return { valid: false, error: `IPv4-mapped IPv6 address is prohibited: ${mappedErr}` };
			}
		}

		// 7. Deprecated IPv4-compatible IPv6 (::0:0/96, not :: or ::1)
		const isIPv4Compatible = hextets.slice(0, 6).every((h) => h === 0) && (hextets[6] !== 0 || hextets[7] > 1);
		if (isIPv4Compatible) {
			const compatOctets = [
				(hextets[6] >> 8) & 0xff,
				hextets[6] & 0xff,
				(hextets[7] >> 8) & 0xff,
				hextets[7] & 0xff,
			];
			const compatErr = checkProhibitedIPv4(compatOctets);
			if (compatErr) {
				return { valid: false, error: `IPv4-compatible IPv6 address is prohibited: ${compatErr}` };
			}
		}
	} else if (hostname.includes(":")) {
		return { valid: false, error: "Malformed IPv6 address in URL: missing brackets" };
	}

	return { valid: true, parsedUrl: parsed };
}

/**
 * Conservatively counts readable paragraphs in Markdown article content.
 * Filters out Markdown headers, horizontal rules, standalone images, and short navigation/boilerplate blocks.
 */
export function countParagraphs(content: string): number {
	if (!content || typeof content !== "string") {
		return 0;
	}

	// Split by two or more newlines or lines containing only whitespace
	const blocks = content.split(/\n\s*\n/);
	let count = 0;

	for (const rawBlock of blocks) {
		const block = rawBlock.trim();
		if (!block) continue;

		// Skip pure markdown headings: e.g. "# Title" or "## Subtitle"
		if (/^#{1,6}\s+.+$/.test(block) && !block.includes("\n")) {
			continue;
		}

		// Skip horizontal rules: "---", "***", "___"
		if (/^[-*_]{3,}$/.test(block)) {
			continue;
		}

		// Skip standalone images: ![alt](url)
		if (/^!\[.*?\]\(.*?\)$/.test(block)) {
			continue;
		}

		// Skip standalone links or navigation items: [Text](url)
		if (/^\[.*?\]\(.*?\)$/.test(block)) {
			continue;
		}

		// Must contain meaningful text (at least 15 alphanumeric characters)
		const alphanumericLength = block.replace(/[^a-zA-Z0-9]/g, "").length;
		if (alphanumericLength >= 15) {
			count++;
		}
	}

	return count;
}

/**
 * Extracts the full readable content of an article via Jina Reader API (https://r.jina.ai/).
 * Sends HTTP POST with JSON body containing the validated target URL.
 * Requests markdown output via X-Respond-With header.
 * Attaches Authorization header only when apiKey is provided.
 */
export async function extractArticleWithJina(
	url: string,
	apiKey?: string,
	timeoutMs = 60000
): Promise<JinaExtractionOutcome> {
	// 1. Security check on URL
	const urlValidation = validateArticleUrl(url);
	if (!urlValidation.valid) {
		return {
			success: false,
			status: 400,
			error: `URL validation failed: ${urlValidation.error}`,
		};
	}

	// 2. Prepare request headers
	const headers: Record<string, string> = {
		Accept: "application/json",
		"Content-Type": "application/json",
		"X-Respond-With": "markdown",
	};

	const cleanKey = apiKey?.trim();
	if (cleanKey) {
		headers.Authorization = `Bearer ${cleanKey}`;
	}

	// 3. Setup abort timeout controller
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	let response: Response;
	try {
		response = await fetch(JINA_READER_API_URL, {
			method: "POST",
			headers,
			body: JSON.stringify({ url }),
			signal: controller.signal,
		});
	} catch (err: unknown) {
		clearTimeout(timeoutId);
		const isAbort = err instanceof Error && err.name === "AbortError";
		return {
			success: false,
			status: isAbort ? 504 : 502,
			error: isAbort
				? "Jina Reader request timed out after 60 seconds"
				: "Failed to connect to Jina Reader API",
		};
	} finally {
		clearTimeout(timeoutId);
	}

	// 4. Handle HTTP status errors with secret-safe messages
	if (!response.ok) {
		const status = response.status;
		let detail = "";
		try {
			const errBody = (await response.json()) as { message?: string; error?: string };
			const msg = errBody?.message || errBody?.error;
			if (typeof msg === "string" && msg.trim()) {
				detail = `: ${msg.trim()}`;
			}
		} catch {
			// Ignore parse error
		}

		if (status === 401 || status === 403) {
			return {
				success: false,
				status: 502,
				error: "Jina Reader API authentication failed. Please check your JINA_API_KEY configuration.",
			};
		}

		if (status === 402) {
			return {
				success: false,
				status: 502,
				error: "Jina Reader payment required or free extraction quota exhausted.",
			};
		}

		if (status === 422) {
			return {
				success: false,
				status: 422,
				error: `Jina Reader could not process or extract content from the target URL${detail}`,
			};
		}

		if (status === 429) {
			return {
				success: false,
				status: 429,
				error: "Jina Reader API rate limit exceeded. Please retry later.",
			};
		}

		if (status === 451) {
			return {
				success: false,
				status: 451,
				error: "Target article is unavailable or blocked for legal reasons.",
			};
		}

		if (status >= 500) {
			return {
				success: false,
				status: 502,
				error: `Jina Reader upstream server error: HTTP ${status}`,
			};
		}

		return {
			success: false,
			status: status >= 400 && status < 500 ? status : 502,
			error: `Jina Reader returned HTTP error ${status}${detail}`,
		};
	}

	// 5. Parse response JSON (read once in-memory)
	let responseJson: unknown;
	try {
		responseJson = await response.json();
	} catch {
		return {
			success: false,
			status: 502,
			error: "Invalid JSON response received from Jina Reader API",
		};
	}

	if (!responseJson || typeof responseJson !== "object") {
		return {
			success: false,
			status: 502,
			error: "Invalid response format received from Jina Reader API",
		};
	}

	const typedResponse = responseJson as {
		code?: number;
		status?: number;
		data?: JinaExtractedData;
	};

	const data = typedResponse.data;
	if (!data || typeof data !== "object") {
		return {
			success: false,
			status: 502,
			error: "Missing data object in Jina Reader response",
		};
	}

	// 6. Validate extracted content
	const content = data.content;
	if (typeof content !== "string" || !content.trim()) {
		return {
			success: false,
			status: 502,
			error: "Extracted article content is empty or missing from Jina Reader response",
		};
	}

	const trimmedContent = content.trim();
	const contentLength = trimmedContent.length;
	const paragraphCount = countParagraphs(trimmedContent);

	return {
		success: true,
		extracted_title: typeof data.title === "string" && data.title.trim() ? data.title.trim() : undefined,
		extracted_url: typeof data.url === "string" && data.url.trim() ? data.url.trim() : undefined,
		content: trimmedContent,
		content_length: contentLength,
		paragraph_count: paragraphCount,
		format: "markdown",
		extracted_at: new Date().toISOString(),
	};
}
