# pumpkinway

A single shared group feed — post, react, and talk. One page, one group, one patch.

## What's hosted where

- **GitHub Pages** (`https://pumpkin121267.github.io/pumpkinway/`, `main` branch):
  the site. Updated automatically by `.github/workflows/deploy.yml` on every push.
- **Firebase Firestore** (project `pumpkinw`): the live backend for the published
  site. Posts live in the `posts` collection; the browser talks to Firestore
  directly using the Firebase SDK included in `public/index.html`. New posts and
  comments go in as `pending` and appear after an admin approves them.
- **Netlify** (`https://pumpkinway-live.netlify.app`): an alternative API backend
  (`netlify/functions/api.js`) — currently **not deployable** because the account
  has exceeded its usage credits. The frontend can use it later if credits are
  added; Firestore is the active backend today.
- **Static fallback**: if every live backend is unreachable, the site shows the
  read-only `public/api/posts.json` snapshot built by `scripts/build-static.js`.

The frontend picks the backend automatically: Firestore on a published host,
the same-origin `/api` on localhost (local `npm start`), then a `REMOTE_API` host
if configured, then the static snapshot.

## Admin access

Admin password for the published site: **`pumpkin-8fa2c1c0bc`**

The password is checked **server-side** by Firestore rules: opening Admin tries
to write a check document whose password must match the value in the deployed
rules, and check documents can never be read back by clients. The real rules
file (`firestore.rules`) is gitignored because it contains the password —
`firestore.rules.example` is the safe template. To change the password:

```bash
cp firestore.rules.example firestore.rules
# edit REPLACE_WITH_ADMIN_PASSWORD in firestore.rules
npx firebase-tools deploy --only firestore:rules --project pumpkinw --force
```

**Security note:** the feed itself allows open reads/writes (this is a demo
group feed), so moderation is a UI convenience, not a hardened permission
boundary. Don't put private data in it.

## Local development

```bash
npm start          # http://127.0.0.1:8765 — full API with data/posts.json file storage
```

Localhost URLs deliberately bypass Firestore so local moderation writes stay in
`data/posts.json`.

## Repo layout

- `public/` — the site (`index.html`, images, `_redirects`, `api/posts.json` fallback)
- `server.js` — local Node server + REST API (file storage in `data/posts.json`)
- `netlify/functions/api.js` — optional Netlify Functions API (Netlify Blobs storage)
- `functions/index.js` — prepared Firebase HTTPS API (Admin SDK + Cloud Storage);
  not deployed yet. It would need a Firebase Blaze (billing) plan, then a
  `hosting` rewrite for `/api/**` to the `api` function.
- `storage.rules` — denies direct client access to the images bucket (Admin SDK only)
- `scripts/build-static.js` — generates the read-only feed snapshot
- `firestore.rules.example` — template for the deployed Firestore rules
- `firebase.json` / `netlify.toml` — configs for those hosting options

## Notes

- GitHub Pages on a free plan requires the repo to be **public**.
- The old default password `pumpkin2026` in `server.js` / the Netlify function is
  only for local or alternative hosting — override it with `ADMIN_PASS`.
