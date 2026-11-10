# pumpkinway

A single shared group feed — post, react, and talk. One page, one group, one patch.

## What's hosted where

- **GitHub Pages** (this repo, `main` branch): the static, read-only site at
  `https://<your-username>.github.io/pumpkinway/`. It shows a published snapshot of the
  approved posts (built from `data/posts.json` by `scripts/build-static.js`). Posting,
  commenting, and liking are disabled on the static host.
- **Live app** (optional, full features): run `server.js` yourself, or deploy to a host
  that runs Node (e.g. Render, Railway, Fly.io) or Netlify (the function is in
  `public/netlify/functions/api.js`). When the page detects a working `/api`, it
  automatically switches to the live mode with posting, comments, likes, and admin
  moderation.

## Local development (live mode)

```bash
npm start          # serves http://127.0.0.1:8765 with the full API
```

Admin password defaults to `pumpkin2026` — override it with the `ADMIN_PASS`
environment variable in any real deployment. Never commit a real password.

## Updating the published feed on GitHub Pages

1. Run `npm start`, open the site, and approve posts/comments as admin
   (moderation writes to `data/posts.json`).
2. Commit and push:

```bash
git add data/posts.json
git commit -m "Update feed"
git push
```

The GitHub Action (`.github/workflows/deploy.yml`) rebuilds `public/api/posts.json`
and republishes the site automatically on every push to `main`.

## Repo layout

- `public/` — the site (`index.html`, images, `api/posts.json` snapshot)
- `server.js` — local Node server + REST API (file storage in `data/posts.json`)
- `public/netlify/functions/api.js` — Netlify Functions version of the same API
- `scripts/build-static.js` — generates the read-only feed snapshot
- `firebase.json` / `netlify.toml` — configs for those hosting options

## Notes

- GitHub Pages on a free plan requires the repo to be **public**.
- The default admin password lives in code, so change it via `ADMIN_PASS` for any
  live deployment.
