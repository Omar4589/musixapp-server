// /config/cors.js
const isProd = process.env.NODE_ENV === "production";

// Exact origins from env (comma-separated)
const allowlist = (process.env.CORS_ALLOWLIST || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Optional domain suffix for wildcard subdomains in prod, e.g. ".yourdomain.com"
const domainSuffix = (process.env.CORS_DOMAIN_SUFFIX || "").trim(); // like ".yourdomain.com"
const suffixRe = domainSuffix
  ? new RegExp(`${domainSuffix.replace(/\./g, "\\.")}$`, "i")
  : null;

// Optional extra regexes (e.g., preview URLs). Keep tight in prod.
const regexAllow = [];
if (!isProd) {
  // Dev only: localhost and LAN IPs
  regexAllow.push(/(^|\.)localhost(:\d+)?$/i);
  regexAllow.push(/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/); // 10.0.2.2, 192.168.x.x, etc.
}
if (suffixRe) {
  // Allow any subdomain of your production suffix
  regexAllow.push(suffixRe);
}

// Helper: safe host extractor
function parseHost(origin) {
  try {
    const url = new URL(origin);
    return url.host; // host includes ":port"
  } catch {
    return null;
  }
}

export const corsOptions = {
  origin: (origin, cb) => {
    // Native/mobile/curl: no Origin header → allow
    if (!origin) return cb(null, true);

    const host = parseHost(origin);
    if (!host) return cb(new Error("Invalid Origin"), false);

    const allowExact = allowlist.includes(origin);
    const allowByRegex = regexAllow.some((re) => re.test(host));

    const ok = allowExact || allowByRegex;
    return cb(ok ? null : new Error("Not allowed by CORS"), ok);
  },

  // Using Bearer tokens, not cookies
  credentials: false,

  // Add PUT if you need it later
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Idempotency-Key",
    "x-refresh-token",
  ],

  // Good defaults
  optionsSuccessStatus: 204,
  preflightContinue: false,
};

// Dev: log blocked origins to console for quick diagnosis
if (!isProd) {
  const _origin = corsOptions.origin;
  corsOptions.origin = (origin, cb) => {
    _origin(origin, (err, ok) => {
      if (err || !ok) console.warn("[CORS BLOCKED]", origin);
      cb(err, ok);
    });
  };
}
