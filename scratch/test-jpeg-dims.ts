import fs from "node:fs";
import path from "node:path";
import { getJpegDimensions, isValidJpegBuffer } from "../src/services/carousel-persistence";

const jpegDir = path.resolve(process.cwd(), "artifacts", "task18-jpegs");
for (let i = 1; i <= 5; i++) {
  const pad = String(i).padStart(2, "0");
  const bytes = fs.readFileSync(path.join(jpegDir, `slide-${pad}.jpg`));
  const valid = isValidJpegBuffer(bytes);
  const dims = getJpegDimensions(bytes);
  console.log(`Slide ${i}: valid=${valid}, dims=${dims ? `${dims.width}x${dims.height}` : "null"}`);
}
