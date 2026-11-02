import fs from "fs";
import zlib from "zlib";
import path from "path";

function crc32(buf) {
	let c = ~0;
	for (let i = 0; i < buf.length; i++) {
		c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff];
	}
	return (~c) >>> 0;
}
const table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
	let c = i;
	for (let k = 0; k < 8; k++) {
		c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	}
	table[i] = c;
}

function makeChunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeBuf = Buffer.from(type, "ascii");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
	return Buffer.concat([len, typeBuf, data, crc]);
}

function encodeRGBAtoPNG(width, height, rgbaBuffer) {
	const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6; // RGBA
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;
	const ihdrChunk = makeChunk("IHDR", ihdr);

	const stride = 1 + width * 4;
	const raw = Buffer.alloc(height * stride);
	for (let y = 0; y < height; y++) {
		raw[y * stride] = 0;
		rgbaBuffer.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
	}

	const compressed = zlib.deflateSync(raw, { level: 9 });
	const idatChunk = makeChunk("IDAT", compressed);
	const iendChunk = makeChunk("IEND", Buffer.alloc(0));

	return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

function unfilterPNG(filePath) {
	const buf = fs.readFileSync(filePath);
	const width = buf.readUInt32BE(16);
	const height = buf.readUInt32BE(20);
	let pos = 8;
	const idats = [];
	while (pos < buf.length) {
		const len = buf.readUInt32BE(pos);
		const type = buf.toString("ascii", pos + 4, pos + 8);
		if (type === "IDAT") idats.push(buf.subarray(pos + 8, pos + 8 + len));
		pos += 12 + len;
	}
	const decompressed = zlib.inflateSync(Buffer.concat(idats));
	const bpp = 3;
	const stride = 1 + width * bpp;
	const raw = Buffer.alloc(width * height * bpp);

	for (let y = 0; y < height; y++) {
		const filter = decompressed[y * stride];
		const rowIn = y * stride + 1;
		const rowOut = y * width * bpp;
		const prevRowOut = (y - 1) * width * bpp;

		for (let x = 0; x < width * bpp; x++) {
			const xByte = decompressed[rowIn + x];
			const a = x >= bpp ? raw[rowOut + x - bpp] : 0;
			const b = y > 0 ? raw[prevRowOut + x] : 0;
			const c = y > 0 && x >= bpp ? raw[prevRowOut + x - bpp] : 0;

			let val = 0;
			if (filter === 0) val = xByte;
			else if (filter === 1) val = (xByte + a) & 0xff;
			else if (filter === 2) val = (xByte + b) & 0xff;
			else if (filter === 3) val = (xByte + Math.floor((a + b) / 2)) & 0xff;
			else if (filter === 4) {
				const p = a + b - c;
				const pa = Math.abs(p - a);
				const pb = Math.abs(p - b);
				const pc = Math.abs(p - c);
				const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
				val = (xByte + pr) & 0xff;
			}
			raw[rowOut + x] = val;
		}
	}

	return { width, height, raw };
}

const srcFile = path.resolve("public/brand/source/lawbriefly-primary-logo-original.png");
const outDir = path.resolve("public/brand/processed");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const { width: fullW, height: fullH, raw } = unfilterPNG(srcFile);

function cropAlpha(minX, maxX, minY, maxY, colorR, colorG, colorB) {
	const w = maxX - minX + 1;
	const h = maxY - minY + 1;
	const rgba = Buffer.alloc(w * h * 4);

	for (let y = 0; y < h; y++) {
		const srcY = minY + y;
		for (let x = 0; x < w; x++) {
			const srcX = minX + x;
			const srcIdx = (srcY * fullW + srcX) * 3;
			const r = raw[srcIdx];
			const g = raw[srcIdx + 1];
			const b = raw[srcIdx + 2];
			const lum = 0.299 * r + 0.587 * g + 0.114 * b;
			// In original image: background is white (lum ~ 255), logo is black (lum ~ 0)
			const alpha = Math.max(0, Math.min(255, Math.round(255 - lum)));

			const dstIdx = (y * w + x) * 4;
			rgba[dstIdx] = colorR;
			rgba[dstIdx + 1] = colorG;
			rgba[dstIdx + 2] = colorB;
			rgba[dstIdx + 3] = alpha;
		}
	}
	return encodeRGBAtoPNG(w, h, rgba);
}

// 1. Monogram bounds: minX: 388, maxX: 923, minY: 228, maxY: 841
const monoMinX = 388, monoMaxX = 923, monoMinY = 228, monoMaxY = 841;
fs.writeFileSync(path.join(outDir, "lb-monogram-white.png"), cropAlpha(monoMinX, monoMaxX, monoMinY, monoMaxY, 255, 255, 255));
fs.writeFileSync(path.join(outDir, "lb-monogram-dark.png"), cropAlpha(monoMinX, monoMaxX, monoMinY, monoMaxY, 11, 15, 25));
console.log("Generated lb-monogram PNGs");

// 2. Wordmark bounds: minX: 187, maxX: 1089, minY: 881, maxY: 1072
const wordMinX = 187, wordMaxX = 1089, wordMinY = 881, wordMaxY = 1072;
fs.writeFileSync(path.join(outDir, "lb-wordmark-white.png"), cropAlpha(wordMinX, wordMaxX, wordMinY, wordMaxY, 255, 255, 255));
fs.writeFileSync(path.join(outDir, "lb-wordmark-dark.png"), cropAlpha(wordMinX, wordMaxX, wordMinY, wordMaxY, 11, 15, 25));
console.log("Generated lb-wordmark PNGs");

// 3. Full stacked logo: minX: 187, maxX: 1089, minY: 228, maxY: 1072
fs.writeFileSync(path.join(outDir, "lb-stacked-white.png"), cropAlpha(wordMinX, wordMaxX, monoMinY, wordMaxY, 255, 255, 255));
fs.writeFileSync(path.join(outDir, "lb-stacked-dark.png"), cropAlpha(wordMinX, wordMaxX, monoMinY, wordMaxY, 11, 15, 25));
console.log("Generated lb-stacked PNGs");

// 4. Horizontal lockup: Monogram on left + Wordmark on right
function createHorizontalLockup(colorR, colorG, colorB) {
	const monoW = monoMaxX - monoMinX + 1;
	const monoH = monoMaxY - monoMinY + 1;
	const wordW = wordMaxX - wordMinX + 1;
	const wordH = wordMaxY - wordMinY + 1;

	// In the brand banner, wordmark height is roughly 44% of monogram height
	const targetMonoH = 614;
	const targetMonoW = monoW;
	const targetWordH = Math.round(targetMonoH * 0.44); // ~270px
	const scale = targetWordH / wordH;
	const targetWordW = Math.round(wordW * scale); // ~1270px

	const gap = Math.round(targetMonoH * 0.16); // ~98px
	const totalW = targetMonoW + gap + targetWordW;
	const totalH = targetMonoH;

	const rgba = Buffer.alloc(totalW * totalH * 4);

	// 1. Draw monogram
	for (let y = 0; y < targetMonoH; y++) {
		const srcY = monoMinY + y;
		for (let x = 0; x < targetMonoW; x++) {
			const srcX = monoMinX + x;
			const srcIdx = (srcY * fullW + srcX) * 3;
			const lum = 0.299 * raw[srcIdx] + 0.587 * raw[srcIdx + 1] + 0.114 * raw[srcIdx + 2];
			const alpha = Math.max(0, Math.min(255, Math.round(255 - lum)));

			const dstIdx = (y * totalW + x) * 4;
			rgba[dstIdx] = colorR;
			rgba[dstIdx + 1] = colorG;
			rgba[dstIdx + 2] = colorB;
			rgba[dstIdx + 3] = alpha;
		}
	}

	// 2. Draw wordmark centered vertically
	const wordOffsetY = Math.round((totalH - targetWordH) / 2) + 8;
	const wordOffsetX = targetMonoW + gap;

	for (let y = 0; y < targetWordH; y++) {
		const origY = wordMinY + Math.min(wordH - 1, Math.floor(y / scale));
		const dstY = wordOffsetY + y;
		if (dstY >= totalH) continue;

		for (let x = 0; x < targetWordW; x++) {
			const origX = wordMinX + Math.min(wordW - 1, Math.floor(x / scale));
			const dstX = wordOffsetX + x;
			if (dstX >= totalW) continue;

			const srcIdx = (origY * fullW + origX) * 3;
			const lum = 0.299 * raw[srcIdx] + 0.587 * raw[srcIdx + 1] + 0.114 * raw[srcIdx + 2];
			const alpha = Math.max(0, Math.min(255, Math.round(255 - lum)));

			const dstIdx = (dstY * totalW + dstX) * 4;
			rgba[dstIdx] = colorR;
			rgba[dstIdx + 1] = colorG;
			rgba[dstIdx + 2] = colorB;
			rgba[dstIdx + 3] = alpha;
		}
	}

	return encodeRGBAtoPNG(totalW, totalH, rgba);
}

fs.writeFileSync(path.join(outDir, "lb-horizontal-white.png"), createHorizontalLockup(255, 255, 255));
fs.writeFileSync(path.join(outDir, "lb-horizontal-dark.png"), createHorizontalLockup(11, 15, 25));
console.log("Generated lb-horizontal PNGs");
