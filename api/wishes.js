/**
 * Vercel serverless API for the card. Wishes live in Vercel Blob storage,
 * one small JSON file per wish, so simultaneous posts never overwrite
 * each other.
 *
 * Requires a Blob store connected to the project (Storage tab in Vercel),
 * which sets BLOB_READ_WRITE_TOKEN automatically.
 */
const { put, list, del } = require('@vercel/blob');
const { randomUUID } = require('crypto');

const LIMITS = { name: 40, location: 60, message: 500 };

function cleanField(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

async function loadWishes() {
  const { blobs } = await list({ prefix: 'wishes/' });
  const results = await Promise.all(
    blobs.map(async blob => {
      try {
        const response = await fetch(blob.url);
        return await response.json();
      } catch {
        return null;
      }
    })
  );
  return results
    .filter(w => w && w.id && w.name && w.message)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

module.exports = async (req, res) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({
      error: 'Storage is not connected yet. In Vercel, open the Storage tab and add a Blob store to this project.'
    });
  }

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ wishes: await loadWishes() });
    }

    if (req.method === 'POST') {
      const data = req.body || {};
      const name = cleanField(data.name, LIMITS.name);
      const location = cleanField(data.location, LIMITS.location);
      const message = typeof data.message === 'string'
        ? data.message.replace(/\r\n/g, '\n').replace(/[^\S\n]+/g, ' ').trim().slice(0, LIMITS.message)
        : '';

      if (!name) return res.status(400).json({ error: 'Add your name so Angel knows who this is from.' });
      if (!message) return res.status(400).json({ error: 'The wish itself is the important part. Write something!' });

      const wish = { id: randomUUID(), name, location, message, createdAt: new Date().toISOString() };
      await put(`wishes/${wish.id}.json`, JSON.stringify(wish), {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'application/json'
      });
      return res.status(201).json({ wish });
    }

    if (req.method === 'DELETE') {
      const adminKey = process.env.ADMIN_KEY || '';
      if (!adminKey || req.headers['x-admin-key'] !== adminKey) {
        return res.status(403).json({ error: 'Not allowed.' });
      }
      const id = String(req.query.id || '');
      if (!/^[a-z0-9-]+$/i.test(id)) return res.status(400).json({ error: 'Bad id.' });
      const { blobs } = await list({ prefix: `wishes/${id}` });
      if (!blobs.length) return res.status(404).json({ error: 'No such wish.' });
      await del(blobs.map(b => b.url));
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: 'Something went wrong on our side.' });
  }
};
