function checkProhibitedIPv4(octets) {
	if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) {
		return "Malformed IPv4 address";
	}
	if (octets[0] === 0) {
		return "Zero/unspecified IPv4 addresses are prohibited";
	}
	if (octets[0] === 127) {
		return "Loopback IPv4 addresses are prohibited";
	}
	if (octets[0] === 10) {
		return "Private IPv4 addresses (10.0.0.0/8) are prohibited";
	}
	if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
		return "Private IPv4 addresses (172.16.0.0/12) are prohibited";
	}
	if (octets[0] === 192 && octets[1] === 168) {
		return "Private IPv4 addresses (192.168.0.0/16) are prohibited";
	}
	if (octets[0] === 169 && octets[1] === 254) {
		return "Link-local IPv4 addresses (169.254.0.0/16) are prohibited";
	}
	return null;
}

function parseIPv6(ipStr) {
	if (!ipStr || typeof ipStr !== "string") return null;
	const clean = ipStr.trim().toLowerCase();
	if (clean.includes("%")) return null;
	const doubleColonCount = clean.split("::").length - 1;
	if (doubleColonCount > 1) return null;
	let leftPart = clean;
	let rightPart = null;
	if (doubleColonCount === 1) {
		const parts = clean.split("::");
		leftPart = parts[0];
		rightPart = parts[1];
	}
	const parseHextets = (part) => {
		if (!part) return [];
		const tokens = part.split(":");
		const hextets = [];
		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			if (token.includes(".")) {
				if (i !== tokens.length - 1) return null;
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
	const zeros = new Array(zerosNeeded).fill(0);
	return [...leftHextets, ...zeros, ...rightHextets];
}

function validateArticleUrl(rawUrl) {
	if (typeof rawUrl !== "string" || !rawUrl.trim()) {
		return { valid: false, error: "Missing or empty article URL" };
	}
	let parsed;
	try {
		parsed = new URL(rawUrl.trim());
	} catch {
		return { valid: false, error: "Malformed URL: failed to parse" };
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return { valid: false, error: `Unsupported URL protocol: "${parsed.protocol}". Only HTTP and HTTPS are permitted.` };
	}
	if (parsed.username || parsed.password) {
		return { valid: false, error: "Embedded credentials (username/password) are not permitted in URLs" };
	}
	const hostname = parsed.hostname.toLowerCase();
	if (
		hostname === "localhost" ||
		hostname.endsWith(".localhost") ||
		hostname.endsWith(".local") ||
		hostname.endsWith(".internal") ||
		hostname.endsWith(".lan")
	) {
		return { valid: false, error: `Invalid hostname "${hostname}": local and internal domains are prohibited` };
	}
	const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
	if (ipv4Match) {
		const octets = [Number(ipv4Match[1]), Number(ipv4Match[2]), Number(ipv4Match[3]), Number(ipv4Match[4])];
		const ipv4Err = checkProhibitedIPv4(octets);
		if (ipv4Err) return { valid: false, error: ipv4Err };
	}
	const isIPv6Bracketed = hostname.startsWith("[") && hostname.endsWith("]");
	if (isIPv6Bracketed) {
		const cleanHostname = hostname.slice(1, -1);
		const hextets = parseIPv6(cleanHostname);
		if (!hextets) {
			return { valid: false, error: `Malformed or ambiguous IPv6 literal: ${cleanHostname}` };
		}
		const isLoopback = hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 1;
		if (isLoopback) return { valid: false, error: "Loopback IPv6 addresses (::1) are prohibited" };
		const isUnspecified = hextets.every((h) => h === 0);
		if (isUnspecified) return { valid: false, error: "Zero/unspecified IPv6 addresses (::) are prohibited" };
		if ((hextets[0] & 0xffc0) === 0xfe80) return { valid: false, error: "Link-local IPv6 addresses (fe80::/10) are prohibited" };
		if ((hextets[0] & 0xfe00) === 0xfc00) return { valid: false, error: "Private/unique-local IPv6 addresses (fc00::/7) are prohibited" };
		if ((hextets[0] & 0xffc0) === 0xfec0) return { valid: false, error: "Site-local IPv6 addresses (fec0::/10) are prohibited" };
		const isIPv4Mapped = hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff;
		if (isIPv4Mapped) {
			const mappedOctets = [(hextets[6] >> 8) & 0xff, hextets[6] & 0xff, (hextets[7] >> 8) & 0xff, hextets[7] & 0xff];
			const mappedErr = checkProhibitedIPv4(mappedOctets);
			if (mappedErr) return { valid: false, error: `IPv4-mapped IPv6 address is prohibited: ${mappedErr}` };
		}
	} else if (hostname.includes(":")) {
		return { valid: false, error: "Malformed IPv6 address in URL: missing brackets" };
	}
	return { valid: true, parsedUrl: parsed };
}

const urlsToTest = [
	{ url: "http://[::1]/", expectValid: false },
	{ url: "http://[::]/", expectValid: false },
	{ url: "http://[fe80::1]/", expectValid: false },
	{ url: "http://[fe90::1]/", expectValid: false },
	{ url: "http://[febf::1]/", expectValid: false },
	{ url: "http://[fc00::1]/", expectValid: false },
	{ url: "http://[fc80::1]/", expectValid: false },
	{ url: "http://[fd00::1]/", expectValid: false },
	{ url: "http://[fd80::1]/", expectValid: false },
	{ url: "http://[::ffff:127.0.0.1]/", expectValid: false },
	{ url: "http://[::ffff:10.0.0.1]/", expectValid: false },
	{ url: "http://[::ffff:192.168.1.1]/", expectValid: false },
	{ url: "http://[febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff]/", expectValid: false },
	{ url: "http://[fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]/", expectValid: false },
	{ url: "http://[2001:db8::1]/article", expectValid: true },
	{ url: "https://example.com/legal-news", expectValid: true },
];

for (const t of urlsToTest) {
	const res = validateArticleUrl(t.url);
	const pass = res.valid === t.expectValid;
	console.log(pass ? "OK  " : "FAIL", t.url, "=> valid:", res.valid, res.error || "");
}
