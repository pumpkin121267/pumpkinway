#!/usr/bin/env node
/**
 * Builds the read-only feed snapshot for static hosting (GitHub Pages).
 * Reads data/posts.json, keeps approved posts and approved comments only,
 * and writes public/api/posts.json in the same shape as the live API response.
 */
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "posts.json");
const OUT_DIR = path.join(__dirname, "..", "public", "api");
const OUT_FILE = path.join(OUT_DIR, "posts.json");

function readPosts() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

const posts = readPosts()
  .filter((p) => p.status === "approved")
  .map((p) => ({
    ...p,
    comments: (p.comments || []).filter((c) => c.status === "approved"),
  }));

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(
  OUT_FILE,
  JSON.stringify(
    { posts, pending: { posts: 0, comments: 0, total: 0 }, updatedAt: Date.now() },
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(`Wrote ${posts.length} approved post(s) to ${path.relative(process.cwd(), OUT_FILE)}`);
