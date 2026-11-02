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

const testAddresses = [
	"::1",
	"::",
	"fe80::1",
	"fe90::1",
	"febf::1",
	"fc00::1",
	"fc80::1",
	"fd00::1",
	"fd80::1",
	"::ffff:127.0.0.1",
	"::ffff:7f00:1",
	"::ffff:10.0.0.1",
	"::ffff:192.168.1.1",
	"2001:db8::1",
	"2607:f8b0:4005:805::200e",
];

for (const a of testAddresses) {
	const parsed = parseIPv6(a);
	console.log(a, "=>", parsed ? parsed.map(h => h.toString(16)).join(":") : "INVALID");
}
