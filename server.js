import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./browser.js";
import { runAudit } from "./agent.js";
import { assertPublicUrl, normalizeUrl } from "./safety.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 2);
const ACCESS_KEY = process.env.ACCESS_KEY || "";
const AUDIT_TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 6 * 60 * 1000);

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("ANTHROPIC_API_KEY is not set. Audits will fail until you add it to .env");
}
if (!ACCESS_KEY) {
  console.warn("ACCESS_KEY is not set. Anyone who finds this server can run audits on your API credit.");
}

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = launchBrowser().then((b) => {
      b.on("disconnected", () => { browserPromise = null; });
      return b;
    }).catch((e) => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

let active = 0;
const app = express();
app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (_req, res) => res.json({ needsKey: Boolean(ACCESS_KEY) }));

app.get("/api/audit", async (req, res) => {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const send = (event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const fail = (message, code = "error") => { send("fail", { message, code }); res.end(); };

  if (ACCESS_KEY && req.query.key !== ACCESS_KEY) return fail("Enter the access key to run audits.", "unauthorized");

  const url = normalizeUrl(req.query.url);
  if (!url) return fail("Paste a website URL first.");
  try { await assertPublicUrl(url); } catch (e) { return fail(e.message); }

  if (active >= MAX_CONCURRENT) return fail("The server is busy with other audits. Try again in a minute.", "busy");
  active++;

  const ac = new AbortController();
  req.on("close", () => ac.abort());
  const timeout = setTimeout(() => ac.abort(), AUDIT_TIMEOUT_MS);
  const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(": ping\n\n"); }, 15000);

  try {
    send("status", { text: "Starting browser" });
    const browser = await getBrowser();
    await runAudit({ url, browser, emit: send, signal: ac.signal });
    send("done", {});
  } catch (e) {
    if (!req.destroyed) {
      const msg = String(e?.message || e);
      let friendly = "The audit stopped unexpectedly. Try again.";
      if (ac.signal.aborted) friendly = "The audit took too long and was stopped. Try again, or audit a single page.";
      else if (/api key|authentication|401/i.test(msg)) friendly = "The server's Anthropic API key is missing or invalid.";
      else if (/rate limit|429|overloaded|529/i.test(msg)) friendly = "The AI service is busy or rate-limited. Wait a minute and try again.";
      else if (/ran out of steps/.test(msg)) friendly = "The agent ran out of steps before writing the report. Try again.";
      console.error("[audit]", url, msg);
      send("fail", { message: friendly });
    }
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
    active--;
    res.end();
  }
});

app.listen(PORT, () => console.log(`Audit running on http://localhost:${PORT}`));
