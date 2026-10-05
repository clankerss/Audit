import dns from "node:dns/promises";
import net from "node:net";

// For local testing only. Never enable on a public server.
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_NETWORK === "1";

// Buttons/links whose text matches this are never clicked.
// The agent marks claims behind them as "untestable".
export const RISKY_ACTION =
  /\b(connect|wallet|sign|signature|approve|buy|sell|pay|payment|purchase|checkout|deposit|withdraw|swap|mint|send|transfer|subscribe|donate|stake|unstake|claim|bridge|log ?in|sign ?in|sign ?up|register|delete|download|install)\b/i;

// Input fields matching this (by name, id, placeholder, label, autocomplete) are never filled.
export const SENSITIVE_FIELD =
  /pass|email|e-mail|phone|mobile|\btel\b|card|cvc|cvv|iban|ssn|address|seed|mnemonic|private.?key|secret|otp|2fa|birth|first.?name|last.?name|full.?name/i;

function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, p) => (acc << 8) + Number(p), 0) >>> 0;
}
function inRange(ip, base, bits) {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    return [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16],
      ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
    ].some(([base, bits]) => inRange(ip, base, bits));
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
  }
  return true;
}

function badHostname(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local");
}

// Fast check with no DNS lookup (used for every sub-request the browser makes).
export function isBlockedHostSync(rawUrl) {
  if (ALLOW_PRIVATE) return false;
  try {
    const host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, "");
    if (badHostname(host)) return true;
    if (net.isIP(host)) return isPrivateIp(host);
    return false;
  } catch {
    return true;
  }
}

// Full check with DNS lookup (used for every page the agent navigates to or fetches).
export async function assertPublicUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("That is not a valid URL.");
  }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http and https URLs can be audited.");
  if (ALLOW_PRIVATE) return u;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (badHostname(host)) throw new Error("Blocked: that address points to a private network.");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => {
    throw new Error(`Could not find the website "${host}". Check the spelling.`);
  });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error("Blocked: that address points to a private network.");
  return u;
}

export function normalizeUrl(input) {
  const s = String(input || "").trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}
