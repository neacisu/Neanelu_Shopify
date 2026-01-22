import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUERY = process.argv.slice(2).join(' ') || 'chock block a14613';
const envPath = path.resolve(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.error('Missing .env in project root:', envPath);
  process.exit(1);
}

const envRaw = fs.readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envRaw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const cleaned = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed;
  const idx = cleaned.indexOf('=');
  if (idx === -1) continue;
  const key = cleaned.slice(0, idx).trim();
  let val = cleaned.slice(idx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  env[key] = val;
}

const apiKey = env.GOOGLE_API_KEY || env.GOOGLE_SEARCH_API_KEY || '';
const cx = env.GOOGLE_SEARCH_ENGINE_ID || '';

if (!cx) {
  console.error('Missing GOOGLE_SEARCH_ENGINE_ID.');
  process.exit(1);
}

const url = new URL('https://www.googleapis.com/customsearch/v1');
url.searchParams.set('cx', cx);
url.searchParams.set('q', QUERY);
url.searchParams.set('num', '5');

if (!apiKey) {
  console.error('Missing GOOGLE_API_KEY/GOOGLE_SEARCH_API_KEY.');
  process.exit(1);
}

url.searchParams.set('key', apiKey);

const res = await fetch(url.toString());
if (!res.ok) {
  const text = await res.text();
  console.error(`Google CSE error (${res.status}):`, text);
  process.exit(1);
}

const data = await res.json();
const items = (data.items || []).map((item) => ({
  title: item.title,
  link: item.link,
  snippet: item.snippet,
}));

console.log(
  JSON.stringify(
    { query: QUERY, totalResults: data.searchInformation?.totalResults || null, items },
    null,
    2
  )
);
