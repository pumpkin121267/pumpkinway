# pumpkinway

A single shared group feed — post, react, and talk. One page, one group, one patch.

## What's hosted where

- **GitHub Pages** (this repo, `main` branch): the site at
  `https://<your-username>.github.io/pumpkinway/`. It talks to the live API on
  Netlify, so posting, comments, likes, and admin moderation all work. If the
  API is unreachable, it falls back to a read-only snapshot of approved posts.
- **Netlify** (live API + data): the function in `netlify/functions/api.js`
  serves the API from `https://<your-site>.netlify.app` using Netlify Blobs
  storage. Visiting the Netlify URL directly gives the same full site natively.
  Set `ADMIN_PASS` in the Netlify site environment variables.
- **Local development**: `npm start` runs `server.js` with the same API backed
  by `data/posts.json`. The frontend automatically uses whichever API is
  reachable (same-origin first, then the `REMOTE_API` host in
  `public/index.html`, then the static snapshot).

## Local development (live mode)

```bash
npm start          # serves http://127.0.0.1:8765 with the full API
```

Admin password defaults to `pumpkin2026` — override it with the `ADMIN_PASS`
environment variable in any real deployment. Never commit a real password.

## Updating the published feed

Posts created on the live site are stored in Netlify Blobs — no redeploy needed.
Approve them via the Admin button on the site (password = the `ADMIN_PASS` you
set on Netlify).

The static fallback snapshot (`public/api/posts.json`, built by
`scripts/build-static.js` from `data/posts.json`) only shows if the API is ever
unreachable. To refresh it after local `npm start` moderation sessions:

```bash
npm run build:static
git add public/api/posts.json data/posts.json
git commit -m "Update fallback snapshot"
git push
```

## Repo layout

- `public/` — the site (`index.html`, images, `api/posts.json` fallback snapshot)
- `server.js` — local Node server + REST API (file storage in `data/posts.json`)
- `netlify/functions/api.js` — Netlify Functions version of the same API (blobs storage)
- `scripts/build-static.js` — generates the read-only feed snapshot
- `firebase.json` / `netlify.toml` — configs for those hosting options

## Notes

- GitHub Pages on a free plan requires the repo to be **public**.
- The default admin password lives in code, so change it via `ADMIN_PASS` for any
  live deployment.
