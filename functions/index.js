// Firebase HTTP API for pumpkinway.
// Mirrors netlify/functions/api.js, but stores posts in Firestore and images
// in Cloud Storage so the same frontend works on Firebase Hosting.

const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const express = require("express");
const crypto = require("crypto");
const seedPosts = require("./seed-posts.json");

initializeApp();

const db = getFirestore();
const postsRef = db.collection("posts");
const metaRef = db.collection("meta").doc("api");
const ADMIN_PASS = process.env.ADMIN_PASS || "pumpkin2026";

const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG || "{}");
const BUCKET_NAME =
  process.env.STORAGE_BUCKET ||
  firebaseConfig.storageBucket ||
  `${process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT_ID}.firebasestorage.app`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Cache-Control": "no-store",
};

function send(res, status, body) {
  res.status(status).set(cors).json(body);
}

function isAdmin(req) {
  return req.get("x-admin-password") === ADMIN_PASS;
}

function pendingStats(posts) {
  let postsCount = 0;
  let commentsCount = 0;
  for (const post of posts) {
    if (post.status === "pending") postsCount += 1;
    for (const comment of post.comments || []) {
      if (comment.status === "pending") commentsCount += 1;
    }
  }
  return { posts: postsCount, comments: commentsCount, total: postsCount + commentsCount };
}

// Stable content fingerprint: lets clients skip re-rendering when nothing changed.
function fingerprint(posts) {
  let h = posts.length;
  for (const post of posts) {
    h = (h * 31 + (post.id || 0)) % 1e15;
    h = (h * 31 + (post.status === "approved" ? 2 : 1)) % 1e15;
    h = (h * 31 + (post.likes || 0)) % 1e15;
    h = (h * 31 + ((post.comments || []).length)) % 1e15;
    let ch = 0;
    for (const comment of post.comments || []) {
      ch = (ch * 31 + (comment.id || 0) + (comment.status === "approved" ? 2 : 1)) % 1e15;
    }
    h = (h * 31 + ch) % 1e15;
  }
  return h;
}

function publicPosts(posts) {
  return posts
    .filter((p) => p.status === "approved")
    .map((p) => ({
      ...p,
      comments: (p.comments || []).filter((c) => c.status === "approved"),
    }));
}

let seeded = false;
async function ensureSeeded() {
  if (seeded) return;
  seeded = true;
  try {
    const snap = await metaRef.get();
    if (snap.exists) return;
    const batch = db.batch();
    for (const post of seedPosts) {
      batch.set(postsRef.doc(String(post.id)), post);
    }
    await batch.commit();
    await metaRef.set({ seededAt: Date.now() });
  } catch (err) {
    seeded = false;
    throw err;
  }
}

async function loadPosts() {
  await ensureSeeded();
  const snap = await postsRef.orderBy("createdAt", "asc").get();
  return snap.docs.map((doc) => doc.data());
}

function postRef(id) {
  return postsRef.doc(String(id));
}

function newId() {
  // Numeric ids keep the existing frontend/API contract. The extra digits
  // avoid collisions between posts created in the same millisecond.
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function bucket() {
  return getStorage().bucket(BUCKET_NAME);
}

async function uploadImage(dataUrl, id) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!match) throw new Error("Invalid image data");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 2 * 1024 * 1024) throw new Error("Choose an image under 2MB.");

  const mime = match[1];
  const ext = mime.split("/")[1].replace("jpeg", "jpg").replace("svg+xml", "svg");
  const path = `posts/${id}.${ext}`;
  const token = crypto.randomUUID();
  await bucket().file(path).save(bytes, {
    contentType: mime,
    resumable: false,
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

async function deleteImage(image) {
  if (!image || !image.includes("firebasestorage.googleapis.com")) return;
  try {
    const url = new URL(image);
    const encodedPath = url.pathname.split("/o/")[1];
    if (encodedPath) await bucket().file(decodeURIComponent(encodedPath)).delete();
  } catch (err) {
    console.warn("Could not delete image", err.message);
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set(cors);
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});
app.use(express.json({ limit: "8mb" }));

const router = express.Router();

router.get(
  "/posts",
  wrap(async (req, res) => {
    const posts = await loadPosts();
    send(res, 200, {
      posts: isAdmin(req) ? posts : publicPosts(posts),
      pending: pendingStats(posts),
      updatedAt: fingerprint(posts),
    });
  })
);

router.get(
  "/pending",
  wrap(async (req, res) => {
    if (!isAdmin(req)) return send(res, 401, { error: "Admin password required" });
    send(res, 200, pendingStats(await loadPosts()));
  })
);

router.post(
  "/posts",
  wrap(async (req, res) => {
    const body = req.body || {};
    const author = String(body.author || "").trim().slice(0, 20);
    const content = String(body.content || "").trim().slice(0, 5000);
    if (!author) return send(res, 400, { error: "Nickname required" });
    if (!content && !body.image) return send(res, 400, { error: "Write something or add a photo" });

    const id = newId();
    let image = null;
    if (body.image) {
      try {
        image = await uploadImage(body.image, id);
      } catch (err) {
        return send(res, 400, { error: err.message || "Invalid image" });
      }
    }

    const post = {
      id,
      author,
      createdAt: Date.now(),
      content,
      image,
      likes: 0,
      likedBy: [],
      comments: [],
      status: "pending",
    };
    await postRef(id).set(post);
    send(res, 201, { ok: true, post, pending: pendingStats(await loadPosts()) });
  })
);

router.post(
  "/posts/:id/approve",
  wrap(async (req, res) => {
    if (!isAdmin(req)) return send(res, 401, { error: "Admin password required" });
    const id = Number(req.params.id);
    const ref = postRef(id);
    const snap = await ref.get();
    if (!snap.exists) return send(res, 404, { error: "Post not found" });
    await ref.update({ status: "approved" });
    send(res, 200, { ok: true, pending: pendingStats(await loadPosts()) });
  })
);

router.delete(
  "/posts/:id",
  wrap(async (req, res) => {
    if (!isAdmin(req)) return send(res, 401, { error: "Admin password required" });
    const id = Number(req.params.id);
    const ref = postRef(id);
    const snap = await ref.get();
    if (!snap.exists) return send(res, 404, { error: "Post not found" });
    await ref.delete();
    await deleteImage(snap.get("image"));
    send(res, 200, { ok: true, pending: pendingStats(await loadPosts()) });
  })
);

router.post(
  "/posts/:id/like",
  wrap(async (req, res) => {
    const voter = String((req.body || {}).voter || "anon").trim().slice(0, 40) || "anon";
    const id = Number(req.params.id);
    let result = null;
    await db.runTransaction(async (tx) => {
      const ref = postRef(id);
      const snap = await tx.get(ref);
      if (!snap.exists || snap.get("status") !== "approved") return;
      const likedBy = Array.isArray(snap.get("likedBy")) ? [...snap.get("likedBy")] : [];
      const idx = likedBy.indexOf(voter);
      if (idx >= 0) likedBy.splice(idx, 1);
      else likedBy.push(voter);
      tx.update(ref, { likedBy, likes: likedBy.length });
      result = { likes: likedBy.length, liked: idx < 0 };
    });
    if (!result) return send(res, 404, { error: "Post not found" });
    send(res, 200, { ok: true, ...result });
  })
);

router.post(
  "/posts/:id/comments",
  wrap(async (req, res) => {
    const body = req.body || {};
    const author = String(body.author || "").trim().slice(0, 20);
    const text = String(body.text || "").trim().slice(0, 2000);
    if (!author || !text) return send(res, 400, { error: "Nickname and comment required" });

    const id = Number(req.params.id);
    const comment = { id: newId(), author, text, status: "pending", createdAt: Date.now() };
    const ref = postRef(id);
    const snap = await ref.get();
    if (!snap.exists || snap.get("status") !== "approved") return send(res, 404, { error: "Post not found" });
    await ref.update({ comments: [...(snap.get("comments") || []), comment] });
    send(res, 201, { ok: true, comment, pending: pendingStats(await loadPosts()) });
  })
);

router.post(
  "/posts/:id/comments/:commentId/approve",
  wrap(async (req, res) => {
    if (!isAdmin(req)) return send(res, 401, { error: "Admin password required" });
    const ref = postRef(Number(req.params.id));
    const commentId = Number(req.params.commentId);
    const snap = await ref.get();
    const comments = (snap.get("comments") || []).map((c) =>
      c.id === commentId ? { ...c, status: "approved" } : c
    );
    if (!comments.some((c) => c.id === commentId && c.status === "approved")) {
      return send(res, 404, { error: "Comment not found" });
    }
    await ref.update({ comments });
    send(res, 200, { ok: true, pending: pendingStats(await loadPosts()) });
  })
);

router.delete(
  "/posts/:id/comments/:commentId",
  wrap(async (req, res) => {
    if (!isAdmin(req)) return send(res, 401, { error: "Admin password required" });
    const ref = postRef(Number(req.params.id));
    const commentId = Number(req.params.commentId);
    const snap = await ref.get();
    if (!snap.exists) return send(res, 404, { error: "Post not found" });
    const comments = (snap.get("comments") || []).filter((c) => c.id !== commentId);
    if (comments.length === (snap.get("comments") || []).length) {
      return send(res, 404, { error: "Comment not found" });
    }
    await ref.update({ comments });
    send(res, 200, { ok: true, pending: pendingStats(await loadPosts()) });
  })
);

// Hosting forwards /api/** with the original path; direct function URLs use /.
app.use("/api", router);
app.use("/", router);
app.use((req, res) => send(res, 404, { error: "Not found" }));
app.use((err, req, res, next) => {
  console.error("API error", err);
  if (err.type === "entity.parse.failed" || err.type === "entity.too.large") {
    return send(res, 400, { error: "Invalid JSON" });
  }
  send(res, 500, { error: err.message || "Server error" });
});

exports.api = onRequest({ region: "us-central1", maxInstances: 20 }, app);
