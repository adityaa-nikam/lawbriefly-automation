import fs from 'fs';

const lines = fs.readFileSync('.dev.vars', 'utf8').split('\n');
const vars: Record<string, string> = {};
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx !== -1) {
    const k = trimmed.slice(0, idx).trim();
    let v = trimmed.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    vars[k] = v;
  }
}

async function check(days: number) {
	const url = `${vars.LAWBRIEFLY_API_URL}?days=${days}&limit=20`;
	const res = await fetch(url, { headers: { "x-api-key": vars.LAWBRIEFLY_API_KEY || "" } });
	const data = await res.json() as any;
	console.log(`days=${days}: count = ${data.articles?.length || 0}`);
	if (data.articles?.length > 0) {
		console.log(`  first: ${data.articles[0].title}`);
	}
}

async function main() {
	await check(1);
	await check(3);
	await check(7);
}

main();
