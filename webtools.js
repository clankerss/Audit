import { assertPublicUrl } from "./safety.js";

const UA = "Mozilla/5.0 (compatible; AuditBot/0.1; website claim checker)";

async function readLimited(res, limit) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    out += decoder.decode(value, { stream: true });
    if (size > limit) { reader.cancel().catch(() => {}); break; }
  }
  return out;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// Loads a URL without a browser (for checking links: docs, socials, whitepapers).
// Follows redirects manually so every hop is checked against the private-network block.
export async function fetchUrl({ url }) {
  let current = String(url);
  for (let hop = 0; hop < 6; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { "user-agent": UA, accept: "text/html,application/json;q=0.9,*/*;q=0.5" },
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      res.body?.cancel().catch(() => {});
      current = new URL(loc, current).href;
      continue;
    }
    const type = res.headers.get("content-type") || "";
    let title = "";
    let text = "";
    if (/text|json|xml/.test(type)) {
      const body = await readLimited(res, 400_000);
      title = (body.match(/<title[^>]*>([^<]*)/i)?.[1] || "").trim().slice(0, 200);
      text = (/html/.test(type) ? htmlToText(body) : body).slice(0, 2500);
    } else {
      res.body?.cancel().catch(() => {});
    }
    return { status: res.status, finalUrl: current, contentType: type.split(";")[0], title, text };
  }
  throw new Error("Too many redirects.");
}

function ghHeaders() {
  const h = { accept: "application/vnd.github+json", "user-agent": "audit-mvp" };
  if (process.env.GITHUB_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function gh(path) {
  const r = await fetch(`https://api.github.com${path}`, { headers: ghHeaders(), signal: AbortSignal.timeout(15000) });
  if (r.status === 404) return null;
  if (!r.ok) {
    const hint = r.status === 403 || r.status === 429 ? " (rate limit reached; set GITHUB_TOKEN)" : "";
    throw new Error(`GitHub API returned ${r.status}${hint}.`);
  }
  return r.json();
}

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

export async function githubRepo({ owner, repo }) {
  if (!NAME.test(String(owner)) || !NAME.test(String(repo))) throw new Error("Invalid owner or repo name.");
  const base = `/repos/${owner}/${repo}`;
  const info = await gh(base);
  if (!info) return { exists: false, note: `github.com/${owner}/${repo} was not found (deleted, private, or never existed).` };
  const [commits, languages, contents] = await Promise.all([
    gh(`${base}/commits?per_page=10`).catch(() => null),
    gh(`${base}/languages`).catch(() => null),
    gh(`${base}/contents`).catch(() => null),
  ]);
  return {
    exists: true,
    full_name: info.full_name,
    description: info.description,
    is_fork: info.fork,
    forked_from: info.parent?.full_name || null,
    archived: info.archived,
    created_at: info.created_at,
    last_push: info.pushed_at,
    stars: info.stargazers_count,
    forks: info.forks_count,
    open_issues: info.open_issues_count,
    license: info.license?.spdx_id || null,
    languages,
    root_entries: Array.isArray(contents) ? contents.slice(0, 60).map((c) => `${c.type === "dir" ? "dir " : "file"} ${c.name}`) : [],
    recent_commits: Array.isArray(commits)
      ? commits.map((c) => ({
          date: c.commit?.author?.date,
          author: c.author?.login || c.commit?.author?.name,
          message: (c.commit?.message || "").split("\n")[0].slice(0, 100),
        }))
      : [],
  };
}

export async function githubReadFile({ owner, repo, path }) {
  if (!NAME.test(String(owner)) || !NAME.test(String(repo))) throw new Error("Invalid owner or repo name.");
  const clean = String(path || "").replace(/^\/+/, "");
  if (!clean || clean.includes("..")) throw new Error("Invalid file path.");
  const f = await gh(`/repos/${owner}/${repo}/contents/${clean.split("/").map(encodeURIComponent).join("/")}`);
  if (!f) return { exists: false };
  if (Array.isArray(f)) return { exists: true, isDirectory: true, entries: f.slice(0, 80).map((c) => `${c.type === "dir" ? "dir " : "file"} ${c.name}`) };
  const content = f.encoding === "base64" ? Buffer.from(f.content || "", "base64").toString("utf8") : "";
  return { exists: true, size: f.size, content: content.slice(0, 6000), truncated: content.length > 6000 };
}
