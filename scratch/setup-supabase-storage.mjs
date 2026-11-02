import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// Load secrets from .dev.vars if available
const devVarsPath = path.resolve(".dev.vars");
const env = {};
if (fs.existsSync(devVarsPath)) {
	const content = fs.readFileSync(devVarsPath, "utf-8");
	for (const line of content.split("\n")) {
		const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
		if (match) {
			const key = match[1];
			let value = match[2] || "";
			if (value.startsWith('"') && value.endsWith('"')) {
				value = value.slice(1, -1);
			}
			env[key] = value;
		}
	}
}

const supabaseUrl = env.SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
	console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in environment or .dev.vars");
	process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
	auth: { autoRefreshToken: false, persistSession: false },
});

const BUCKET_NAME = "lawbriefly-carousel-assets";

async function setup() {
	console.log(`Checking bucket: ${BUCKET_NAME}...`);
	const { data: buckets, error: listError } = await supabase.storage.listBuckets();
	if (listError) {
		console.error("Failed to list buckets:", listError.message);
		process.exit(1);
	}

	const existing = buckets?.find((b) => b.name === BUCKET_NAME);
	if (existing) {
		console.log(`Bucket '${BUCKET_NAME}' already exists.`);
		console.log(`- Public: ${existing.public}`);
		console.log(`- File Size Limit: ${existing.file_size_limit}`);
		console.log(`- Allowed MIME types:`, existing.allowed_mime_types);
	} else {
		console.log(`Creating private bucket '${BUCKET_NAME}'...`);
		const { data, error: createError } = await supabase.storage.createBucket(BUCKET_NAME, {
			public: false,
			fileSizeLimit: 5 * 1024 * 1024, // 5 MB
			allowedMimeTypes: ["image/png", "application/json"],
		});
		if (createError) {
			console.error("Failed to create bucket:", createError.message);
			process.exit(1);
		}
		console.log(`Successfully created bucket '${BUCKET_NAME}'.`);
	}
}

setup().catch(console.error);
