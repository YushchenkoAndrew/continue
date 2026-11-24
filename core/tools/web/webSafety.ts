import dns from "node:dns/promises";
import net from "node:net";

export class UnsafeUrlError extends Error {}

function ipv4ToInt(ip: string): number {
  return (
    ip.split(".").reduce((acc, p) => (acc << 8) + parseInt(p, 10), 0) >>> 0
  );
}

const V4_PRIVATE: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3], // multicast + reserved (224.0.0.0 - 255.255.255.255)
];

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return V4_PRIVATE.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
    });
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::1" || l === "::") return true;
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^f[cd]/.test(l) || /^fe[89ab]/.test(l);
  }
  return true; // not an IP: caller must resolve first
}

/**
 * Validate that a URL is plain public HTTP(S). Resolves DNS so hostnames that
 * point at private addresses are rejected too. Throws UnsafeUrlError.
 */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http(s) URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs with embedded credentials are not allowed.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    (!host.includes(".") && !net.isIP(host))
  ) {
    throw new UnsafeUrlError(
      "Local and private-network hosts are not allowed.",
    );
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host))
      throw new UnsafeUrlError("Private-network addresses are not allowed.");
    return url;
  }
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new UnsafeUrlError(`Could not resolve ${host}.`);
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    throw new UnsafeUrlError("The host resolves to a private-network address.");
  }
  return url;
}

const SECRET_LIKE: RegExp[] = [
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(ghp|gho|ghu|ghs)_[A-Za-z0-9]{20,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\b(api[_-]?key|secret|token|passw(or)?d|pwd)\s*[:=]\s*["']?[^\s"']{6,}/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT
];

/** Queries leave the machine: refuse anything that looks like source code or a credential. */
export function assertSafeSearchQuery(query: string): void {
  const q = query.trim();
  if (!q) throw new Error("`query` is empty.");
  if (SECRET_LIKE.some((r) => r.test(q))) {
    throw new Error(
      "The query looks like it contains a credential; it was not sent.",
    );
  }
  if (
    q.length > 250 ||
    q.split("\n").length > 2 ||
    /[{};]\s*\n|=>\s*{|\bfunction\s*\(|\bimport\s+.+\s+from\b/.test(q)
  ) {
    throw new Error(
      "Queries are sent to a public search engine: use a short description or an error message, never project source code.",
    );
  }
}
