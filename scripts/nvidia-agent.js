#!/usr/bin/env node
/**
 * Delegation/judging helper for the NVIDIA NIM API (OpenAI-compatible).
 * Never prints or persists the API key. Usage:
 *
 *   node scripts/nvidia-agent.js --model light --prompt-file task.txt --out output.md
 *   node scripts/nvidia-agent.js --model heavy --prompt "..." [--attach file]
 *
 * Models (mapped from the project config):
 *   light -> nvidia/nemotron-3-super-120b-a12b   (fast default)
 *   heavy -> nvidia/nemotron-3-ultra-550b-a55b   (final gate / corrections)
 */
const fs = require('fs');
const path = require('path');

const MODELS = {
  light: 'nvidia/nemotron-3-super-120b-a12b',
  heavy: 'nvidia/nemotron-3-ultra-550b-a55b'
};

async function main() {
  const args = process.argv.slice(2);
  const opt = { model: 'light', attach: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model') opt.model = args[++i];
    else if (args[i] === '--prompt') opt.prompt = args[++i];
    else if (args[i] === '--prompt-file') opt.prompt = fs.readFileSync(args[++i], 'utf8');
    else if (args[i] === '--out') opt.out = args[++i];
    else if (args[i] === '--attach') opt.attach.push(args[++i]);
    else if (args[i] === '--max-tokens') opt.maxTokens = Number(args[++i]);
  }
  if (!opt.prompt) { console.error('missing --prompt/--prompt-file'); process.exit(2); }

  // Resolve the key without echoing it anywhere.
  let key = process.env.NVIDIA_API_KEY;
  if (!key) {
    try {
      const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
      const m = env.match(/^NVIDIA_API_KEY=(.+)$/m);
      key = m && m[1].trim();
    } catch (_e) { /* ignore */ }
  }
  if (!key) { console.error('NVIDIA_API_KEY not set'); process.exit(2); }

  let content = opt.prompt;
  for (const file of opt.attach) {
    content += `\n\n--- ARQUIVO ${file} ---\n` + fs.readFileSync(file, 'utf8');
  }

  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELS[opt.model] || MODELS.light,
      messages: [{ role: 'user', content }],
      max_tokens: opt.maxTokens || 6000,
      temperature: 0.5
    })
  });
  if (!response.ok) {
    console.error(`nvidia-api ${response.status}: ${(await response.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';

  if (opt.out) {
    fs.mkdirSync(path.dirname(opt.out), { recursive: true });
    fs.writeFileSync(opt.out, text);
    console.log(`saved: ${opt.out} (${text.length} chars)`);
  } else {
    process.stdout.write(text);
  }
}

main().catch(error => { console.error('nvidia-agent failed:', error.message); process.exit(1); });
