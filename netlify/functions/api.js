const { getStore } = require("@netlify/blobs");

const ADMIN_PASS = process.env.ADMIN_PASS || "pumpkin2026";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Cache-Control": "no-store",
};

function json(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", ...cors },
    body: JSON.stringify(body),
  };
}

function isAdmin(event) {
  return (event.headers["x-admin-password"] || event.headers["X-Admin-Password"]) === ADMIN_PASS;
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

async function loadPosts() {
  const store = getStore("pumpkinway");
  const raw = await store.get("posts");
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function savePosts(posts) {
  const store = getStore("pumpkinway");
  await store.set("posts", JSON.stringify(posts));
}

function routePath(event) {
  const raw = event.path || "";
  const marker = "/api/";
  const idx = raw.indexOf(marker);
  if (idx >= 0) return raw.slice(idx + marker.length);
  const parts = raw.split("/").filter(Boolean);
  const apiIdx = parts.indexOf("api");
  if (apiIdx >= 0) return parts.slice(apiIdx + 1).join("/");
  return parts.slice(-1)[0] || "";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  try {
    const path = routePath(event);
    const parts = path.split("/").filter(Boolean);
    const admin = isAdmin(event);
    let body = {};
    if (event.body) {
      try {
        body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
      } catch {
        return json(400, { error: "Invalid JSON" });
      }
    }

    if (event.httpMethod === "GET" && parts[0] === "posts" && parts.length === 1) {
      const posts = await loadPosts();
      return json(200, {
        posts: admin ? posts : publicPosts(posts),
        pending: pendingStats(posts),
        updatedAt: fingerprint(posts),
      });
    }

    if (event.httpMethod === "GET" && parts[0] === "pending" && parts.length === 1) {
      if (!admin) return json(401, { error: "Admin password required" });
      return json(200, pendingStats(await loadPosts()));
    }

    if (event.httpMethod === "POST" && parts[0] === "posts" && parts.length === 1) {
      const author = String(body.author || "").trim().slice(0, 20);
      const content = String(body.content || "").trim().slice(0, 5000);
      const image = body.image ? String(body.image) : null;
      if (!author) return json(400, { error: "Nickname required" });
      if (!content && !image) return json(400, { error: "Write something or add a photo" });
      const posts = await loadPosts();
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
      await savePosts(posts);
      return json(201, { ok: true, post, pending: pendingStats(posts) });
    }

    if (event.httpMethod === "POST" && parts[0] === "posts" && parts[2] === "approve" && parts.length === 3) {
      if (!admin) return json(401, { error: "Admin password required" });
      const id = Number(parts[1]);
      const posts = await loadPosts();
      const post = posts.find((p) => p.id === id);
      if (!post) return json(404, { error: "Post not found" });
      post.status = "approved";
      await savePosts(posts);
      return json(200, { ok: true, pending: pendingStats(posts) });
    }

    if (event.httpMethod === "DELETE" && parts[0] === "posts" && parts.length === 2) {
      if (!admin) return json(401, { error: "Admin password required" });
      const id = Number(parts[1]);
      const next = (await loadPosts()).filter((p) => p.id !== id);
      await savePosts(next);
      return json(200, { ok: true, pending: pendingStats(next) });
    }

    if (event.httpMethod === "POST" && parts[0] === "posts" && parts[2] === "like" && parts.length === 3) {
      const voter = String(body.voter || "anon").trim().slice(0, 40) || "anon";
      const id = Number(parts[1]);
      const posts = await loadPosts();
      const post = posts.find((p) => p.id === id);
      if (!post || post.status !== "approved") return json(404, { error: "Post not found" });
      post.likedBy = Array.isArray(post.likedBy) ? post.likedBy : [];
      const idx = post.likedBy.indexOf(voter);
      if (idx >= 0) post.likedBy.splice(idx, 1);
      else post.likedBy.push(voter);
      post.likes = post.likedBy.length;
      await savePosts(posts);
      return json(200, { ok: true, likes: post.likes, liked: idx < 0 });
    }

    if (event.httpMethod === "POST" && parts[0] === "posts" && parts[2] === "comments" && parts.length === 3) {
      const author = String(body.author || "").trim().slice(0, 20);
      const text = String(body.text || "").trim().slice(0, 2000);
      if (!author || !text) return json(400, { error: "Nickname and comment required" });
      const id = Number(parts[1]);
      const posts = await loadPosts();
      const post = posts.find((p) => p.id === id);
      if (!post || post.status !== "approved") return json(404, { error: "Post not found" });
      const comment = { id: Date.now(), author, text, status: "pending", createdAt: Date.now() };
      post.comments = post.comments || [];
      post.comments.push(comment);
      await savePosts(posts);
      return json(201, { ok: true, comment, pending: pendingStats(posts) });
    }

    if (
      event.httpMethod === "POST" &&
      parts[0] === "posts" &&
      parts[2] === "comments" &&
      parts[4] === "approve" &&
      parts.length === 5
    ) {
      if (!admin) return json(401, { error: "Admin password required" });
      const postId = Number(parts[1]);
      const commentId = Number(parts[3]);
      const posts = await loadPosts();
      const post = posts.find((p) => p.id === postId);
      const comment = post?.comments?.find((c) => c.id === commentId);
      if (!comment) return json(404, { error: "Comment not found" });
      comment.status = "approved";
      await savePosts(posts);
      return json(200, { ok: true, pending: pendingStats(posts) });
    }

    if (event.httpMethod === "DELETE" && parts[0] === "posts" && parts[2] === "comments" && parts.length === 4) {
      if (!admin) return json(401, { error: "Admin password required" });
      const postId = Number(parts[1]);
      const commentId = Number(parts[3]);
      const posts = await loadPosts();
      const post = posts.find((p) => p.id === postId);
      if (!post) return json(404, { error: "Post not found" });
      post.comments = (post.comments || []).filter((c) => c.id !== commentId);
      await savePosts(posts);
      return json(200, { ok: true, pending: pendingStats(posts) });
    }

    return json(404, { error: "Not found" });
  } catch (err) {
    return json(500, { error: err.message || "Server error" });
  }
};
