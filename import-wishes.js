/**
 * Copies the wishes saved locally (data/wishes.json) onto the deployed card.
 * Run this ONCE after the Vercel site is live and its Blob store is connected:
 *
 *   node import-wishes.js https://your-project.vercel.app
 */
const fs = require('fs');
const path = require('path');

const target = process.argv[2];
if (!target || !target.startsWith('http')) {
  console.error('Usage: node import-wishes.js https://your-project.vercel.app');
  process.exit(1);
}

const file = path.join(__dirname, 'data', 'wishes.json');
const wishes = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!wishes.length) {
  console.log('No local wishes to import.');
  process.exit(0);
}

(async () => {
  // Oldest first, so they land on the live card in the original order.
  wishes.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  let ok = 0;
  for (const w of wishes) {
    const res = await fetch(`${target.replace(/\/$/, '')}/api/wishes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: w.name, location: w.location, message: w.message })
    });
    if (res.ok) {
      ok++;
      console.log(`✓ imported wish from ${w.name}`);
    } else {
      const data = await res.json().catch(() => ({}));
      console.error(`✗ failed for ${w.name}: ${data.error || res.status}`);
    }
  }
  console.log(`Done: ${ok}/${wishes.length} wishes now on the live card.`);
})();
