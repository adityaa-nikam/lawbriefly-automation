import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

// Load .dev.vars
const content = fs.readFileSync(".dev.vars", "utf8");
const vars = {};
for (const line of content.split(/\r?\n/)) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    vars[match[1]] = (match[2] || "").replace(/^["']|["']$/g, "").trim();
  }
}

const supabase = createClient(vars.SUPABASE_URL, vars.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function apply() {
  console.log("Updating bucket 'lawbriefly-carousel-assets' allowed MIME types...");
  const { data, error } = await supabase.storage.updateBucket("lawbriefly-carousel-assets", {
    public: false,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg", "application/json"],
  });

  if (error) {
    console.error("Update failed:", error.message);
    process.exit(1);
  }

  console.log("Bucket successfully updated:", data);

  // Verify
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucket = buckets?.find((b) => b.name === "lawbriefly-carousel-assets");
  console.log("Verified Remote Bucket Configuration:");
  console.log("- Name:", bucket?.name);
  console.log("- Public:", bucket?.public);
  console.log("- File Size Limit:", bucket?.file_size_limit);
  console.log("- Allowed MIME types:", bucket?.allowed_mime_types);
}

apply().catch(console.error);
