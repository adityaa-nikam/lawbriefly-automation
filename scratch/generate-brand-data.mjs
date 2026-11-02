import fs from "fs";

const whiteBuf = fs.readFileSync("assets/brand/processed/lb-horizontal-white.png");
const darkBuf = fs.readFileSync("assets/brand/processed/lb-horizontal-dark.png");
const monoWhiteBuf = fs.readFileSync("assets/brand/processed/lb-monogram-white.png");
const monoDarkBuf = fs.readFileSync("assets/brand/processed/lb-monogram-dark.png");

const content = `// In-memory base64 brand assets for Cloudflare Workers & Node environments
export const LB_HORIZONTAL_WHITE_DATA_URL = "data:image/png;base64,${whiteBuf.toString("base64")}";
export const LB_HORIZONTAL_DARK_DATA_URL = "data:image/png;base64,${darkBuf.toString("base64")}";
export const LB_MONOGRAM_WHITE_DATA_URL = "data:image/png;base64,${monoWhiteBuf.toString("base64")}";
export const LB_MONOGRAM_DARK_DATA_URL = "data:image/png;base64,${monoDarkBuf.toString("base64")}";
`;

fs.writeFileSync("src/renderer/brand-data.ts", content);
console.log("Created src/renderer/brand-data.ts successfully");
