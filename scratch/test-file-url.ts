import * as fs from "node:fs";

const u = new URL("../wrangler.jsonc", import.meta.url);
const content = fs.readFileSync(u, "utf-8");
console.log("Read wrangler.jsonc length:", content.length);

