# Angel's birthday — a card from everywhere ✈

A shared virtual birthday card. Everyone who gets the link can add a wish, and
every wish lands on the same card, styled as handwritten airmail postcards.

## Preview it locally

```bash
node server.js
```

Then open **http://localhost:3000**. No installs needed, just Node 18+.
Local wishes are saved to `data/wishes.json`. (The local preview and the
deployed site keep separate wishes.)

## Deploy on Vercel

1. Push this folder to GitHub, then in Vercel click **Add New → Project** and
   import it. Framework preset: **Other**. Leave the build command empty.
   (Or run `npx vercel` from this folder if you prefer the CLI.)
2. After the first deploy, open the project's **Storage** tab →
   **Create Database → Blob** → connect it to the project. This is where
   wishes are kept; connecting it adds the `BLOB_READ_WRITE_TOKEN` variable
   automatically. **Redeploy once after connecting** so the token takes effect.
3. Optional: in **Settings → Environment Variables**, add `ADMIN_KEY` with a
   secret of your choosing to enable deleting wishes (see below).
4. Share `https://your-project.vercel.app` with everyone.

Until the Blob store is connected, posting a wish on the deployed site shows
"Storage is not connected yet", so do step 2 before sharing the link.

## Removing a wish (if someone posts something silly)

With `ADMIN_KEY` set (env var on Vercel, or `ADMIN_KEY=secret node server.js`
locally), open the card as `/?key=YOUR_SECRET` and a small ✕ appears on each
card. Nobody without the key can delete anything.

## Making it yours

- Name, date, and all wording live in `public/index.html`.
- Her photos live in `public/photos/`. Swap or add images and update the
  `<figure class="snap">` blocks in `index.html` (captions included).
- Colors and fonts are the CSS variables at the top of `public/styles.css`.

## API (used by the page)

- `GET /api/wishes` — all wishes, newest first
- `POST /api/wishes` — `{ "name", "location", "message" }`
- `DELETE /api/wishes?id=<id>` — requires `x-admin-key` header and `ADMIN_KEY` set
