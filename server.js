#!/usr/bin/env node
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT) || 8765;
const ROOT = path.join(__dirname, "public");
const DATA_FILE = path.join(__dirname, "data", "posts.json");
const ADMIN_PASS = process.env.ADMIN_PASS || "pumpkin2026";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".toml": "text/plain; charset=utf-8",
};

function ensureData() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, "[]\n", "utf8");
  }
}

function readPosts() {
  ensureData();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writePosts(posts) {
  ensureData();
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(posts, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 3.5 * 1024 * 1024) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function isAdmin(req) {
  return req.headers["x-admin-password"] === ADMIN_PASS;
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

function publicPosts(posts, admin) {
  if (admin) return posts;
  return posts
    .filter((p) => p.status === "approved")
    .map((p) => ({
      ...p,
      comments: (p.comments || []).filter((c) => c.status === "approved"),
    }));
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    return send(res, 204, "");
  }

  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const admin = isAdmin(req);

  // GET /api/posts
  if (req.method === "GET" && parts[0] === "posts" && parts.length === 1) {
    const posts = readPosts();
    return send(res, 200, {
      posts: admin ? posts : publicPosts(posts, false),
      pending: pendingStats(posts),
      updatedAt: fs.statSync(DATA_FILE).mtimeMs,
    });
  }

  // GET /api/pending
  if (req.method === "GET" && parts[0] === "pending" && parts.length === 1) {
    if (!admin) return send(res, 401, { error: "Admin password required" });
    const posts = readPosts();
    return send(res, 200, pendingStats(posts));
  }

  // POST /api/posts
  if (req.method === "POST" && parts[0] === "posts" && parts.length === 1) {
    const body = await readBody(req);
    const author = String(body.author || "").trim().slice(0, 20);
    const content = String(body.content || "").trim().slice(0, 5000);
    const image = body.image ? String(body.image) : null;
    if (!author) return send(res, 400, { error: "Nickname required" });
    if (!content && !image) return send(res, 400, { error: "Write something or add a photo" });
    if (image && image.length > 3 * 1024 * 1024) {
      return send(res, 400, { error: "Image too large" });
    }

    const posts = readPosts();
    const post = {
      id: Date.now(),
      author,
      createdAt: Date.now(),
      content,
      image,
      likes: 0,
      likedBy: [],
      comments: [],
      status: "pending",
    };
    posts.push(post);
    writePosts(posts);
    return send(res, 201, { ok: true, post, pending: pendingStats(posts) });
  }

  // POST /api/posts/:id/approve
  if (req.method === "POST" && parts[0] === "posts" && parts[2] === "approve" && parts.length === 3) {
    if (!admin) return send(res, 401, { error: "Admin password required" });
    const id = Number(parts[1]);
    const posts = readPosts();
    const post = posts.find((p) => p.id === id);
    if (!post) return send(res, 404, { error: "Post not found" });
    post.status = "approved";
    writePosts(posts);
    return send(res, 200, { ok: true, pending: pendingStats(posts) });
  }

  // DELETE /api/posts/:id
  if (req.method === "DELETE" && parts[0] === "posts" && parts.length === 2) {
    if (!admin) return send(res, 401, { error: "Admin password required" });
    const id = Number(parts[1]);
    const next = readPosts().filter((p) => p.id !== id);
    writePosts(next);
    return send(res, 200, { ok: true, pending: pendingStats(next) });
  }

  // POST /api/posts/:id/like
  if (req.method === "POST" && parts[0] === "posts" && parts[2] === "like" && parts.length === 3) {
    const body = await readBody(req);
    const voter = String(body.voter || "anon").trim().slice(0, 40) || "anon";
    const id = Number(parts[1]);
    const posts = readPosts();
    const post = posts.find((p) => p.id === id);
    if (!post || post.status !== "approved") return send(res, 404, { error: "Post not found" });
    post.likedBy = Array.isArray(post.likedBy) ? post.likedBy : [];
    const idx = post.likedBy.indexOf(voter);
    if (idx >= 0) post.likedBy.splice(idx, 1);
    else post.likedBy.push(voter);
    post.likes = post.likedBy.length;
    writePosts(posts);
    return send(res, 200, { ok: true, likes: post.likes, liked: idx < 0 });
  }

  // POST /api/posts/:id/comments
  if (req.method === "POST" && parts[0] === "posts" && parts[2] === "comments" && parts.length === 3) {
    const body = await readBody(req);
    const author = String(body.author || "").trim().slice(0, 20);
    const text = String(body.text || "").trim().slice(0, 2000);
    if (!author || !text) return send(res, 400, { error: "Nickname and comment required" });
    const id = Number(parts[1]);
    const posts = readPosts();
    const post = posts.find((p) => p.id === id);
    if (!post || post.status !== "approved") return send(res, 404, { error: "Post not found" });
    const comment = {
      id: Date.now(),
      author,
      text,
      status: "pending",
      createdAt: Date.now(),
    };
    post.comments = post.comments || [];
    post.comments.push(comment);
    writePosts(posts);
    return send(res, 201, { ok: true, comment, pending: pendingStats(posts) });
  }

  // POST /api/posts/:id/comments/:cid/approve
  if (
    req.method === "POST" &&
    parts[0] === "posts" &&
    parts[2] === "comments" &&
    parts[4] === "approve" &&
    parts.length === 5
  ) {
    if (!admin) return send(res, 401, { error: "Admin password required" });
    const postId = Number(parts[1]);
    const commentId = Number(parts[3]);
    const posts = readPosts();
    const post = posts.find((p) => p.id === postId);
    const comment = post?.comments?.find((c) => c.id === commentId);
    if (!comment) return send(res, 404, { error: "Comment not found" });
    comment.status = "approved";
    writePosts(posts);
    return send(res, 200, { ok: true, pending: pendingStats(posts) });
  }

  // DELETE /api/posts/:id/comments/:cid
  if (req.method === "DELETE" && parts[0] === "posts" && parts[2] === "comments" && parts.length === 4) {
    if (!admin) return send(res, 401, { error: "Admin password required" });
    const postId = Number(parts[1]);
    const commentId = Number(parts[3]);
    const posts = readPosts();
    const post = posts.find((p) => p.id === postId);
    if (!post) return send(res, 404, { error: "Post not found" });
    post.comments = (post.comments || []).filter((c) => c.id !== commentId);
    writePosts(posts);
    return send(res, 200, { ok: true, pending: pendingStats(posts) });
  }

  return send(res, 404, { error: "Not found" });
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

ensureData();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url);
    }
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    const message = err.message || "Server error";
    const status = message.includes("too large") ? 413 : 400;
    return send(res, status, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`pumpkinway running at http://127.0.0.1:${PORT}`);
  console.log(`Shared posts file: ${DATA_FILE}`);
});
