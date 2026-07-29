/**
 * Vercel serverless API. Wishes live in the GitHub repo itself, as a single
 * wishes.json on the `wishes-data` branch: one commit per wish, no storage
 * tiers, and the whole card history is preserved in git.
 *
 * Required env: GITHUB_TOKEN, a token with Contents read/write on this repo.
 * Optional env: ADMIN_KEY, enables DELETE /api/wishes?id=... for cleanup.
 */
const { randomUUID } = require('crypto');

const REPO = 'favour-umejesi/angel-birthday-card';
const BRANCH = 'wishes-data';
const FILE_URL = `https://api.github.com/repos/${REPO}/contents/wishes.json`;
const LIMITS = { name: 40, location: 60, message: 1000 };

function gh(url, init = {}) {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'angel-birthday-card',
      ...(init.headers || {})
    }
  });
}

async function readStore() {
  const res = await gh(`${FILE_URL}?ref=${BRANCH}`, { cache: 'no-store' });
  if (res.status === 404) return { wishes: [], sha: null };
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status}`);
  const data = await res.json();
  const wishes = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  return { wishes: Array.isArray(wishes) ? wishes : [], sha: data.sha };
}

function writeStore(wishes, sha, message) {
  return gh(FILE_URL, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      branch: BRANCH,
      sha: sha || undefined,
      content: Buffer.from(JSON.stringify(wishes, null, 2) + '\n').toString('base64')
    })
  });
}

function cleanField(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

module.exports = async (req, res) => {
  if (!process.env.GITHUB_TOKEN) {
    return res.status(500).json({
      error: 'Storage is not connected yet. Add a GITHUB_TOKEN environment variable in Vercel and redeploy.'
    });
  }

  try {
    if (req.method === 'GET') {
      const { wishes } = await readStore();
      wishes.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
      return res.status(200).json({ wishes });
    }

    if (req.method === 'POST') {
      const data = req.body || {};
      const name = cleanField(data.name, LIMITS.name);
      const location = cleanField(data.location, LIMITS.location);
      const message = typeof data.message === 'string'
        ? data.message.replace(/\r\n/g, '\n').replace(/[^\S\n]+/g, ' ').trim().slice(0, LIMITS.message)
        : '';

      if (!name) return res.status(400).json({ error: 'Add your name so Angel knows who this is from.' });
      if (!message) return res.status(400).json({ error: 'You forgot the wish part!' });

      const wish = { id: randomUUID(), name, location, message, createdAt: new Date().toISOString() };

      // Read-modify-write with retries: a concurrent post changes the file's
      // sha and GitHub rejects ours, so we re-read and try again.
      for (let attempt = 0; attempt < 4; attempt++) {
        const { wishes, sha } = await readStore();
        wishes.push(wish);
        const put = await writeStore(wishes, sha, `wish ${wish.id}`);
        if (put.ok) return res.status(201).json({ wish });
        if (put.status !== 409 && put.status !== 422) {
          throw new Error(`GitHub write failed: ${put.status}`);
        }
      }
      return res.status(503).json({ error: 'The card is busy right now. Try again in a few seconds.' });
    }

    if (req.method === 'DELETE') {
      const adminKey = process.env.ADMIN_KEY || '';
      if (!adminKey || req.headers['x-admin-key'] !== adminKey) {
        return res.status(403).json({ error: 'Not allowed.' });
      }
      const id = String(req.query.id || '');
      for (let attempt = 0; attempt < 4; attempt++) {
        const { wishes, sha } = await readStore();
        const remaining = wishes.filter(w => w.id !== id);
        if (remaining.length === wishes.length) return res.status(404).json({ error: 'No such wish.' });
        const put = await writeStore(remaining, sha, `remove wish ${id}`);
        if (put.ok) return res.status(200).json({ ok: true });
        if (put.status !== 409 && put.status !== 422) {
          throw new Error(`GitHub write failed: ${put.status}`);
        }
      }
      return res.status(503).json({ error: 'Busy, try again shortly.' });
    }

    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: 'Something went wrong on our side.' });
  }
};
