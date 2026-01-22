import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env');
let apiKey = process.env.DEEPSEEK_API_KEY || '';

if (!apiKey && fs.existsSync(envPath)) {
  const envRaw = fs.readFileSync(envPath, 'utf-8');
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
    if (key === 'DEEPSEEK_API_KEY') {
      apiKey = val;
      break;
    }
  }
}

if (!apiKey) {
  console.error('Missing DEEPSEEK_API_KEY. Add it to .env or export it before running.');
  process.exit(1);
}

const endpoint = 'https://api.deepseek.com/chat/completions';

const payload = {
  model: 'deepseek-chat',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Spune pe scurt ce este DeepSeek API.' },
  ],
  temperature: 0.2,
  stream: false,
};

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify(payload),
});

if (!response.ok) {
  const text = await response.text();
  console.error(`DeepSeek API error (${response.status}):`, text);
  process.exit(1);
}

const data = await response.json();
console.log('Response:');
console.log(data.choices?.[0]?.message?.content ?? data);
