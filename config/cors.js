// /config/cors.js
const allowlist = (process.env.CORS_ALLOWLIST || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// optional: regexes for subdomains, etc.
const regexAllow = [
  /localhost(:\d+)?$/, // dev
  /\.yourdomain\.com$/i, // *.yourdomain.com
];

export const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // mobile apps / curl / RN fetch
    try {
      const url = new URL(origin);
      const host = url.host; // e.g., admin.yourdomain.com:443
      const allowedByList = allowlist.includes(origin);
      const allowedByRegex = regexAllow.some((re) => re.test(host));
      const ok = allowedByList || allowedByRegex;
      return cb(ok ? null : new Error("Not allowed by CORS"), ok);
    } catch {
      return cb(new Error("Invalid Origin"), false);
    }
  },
  credentials: false,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Idempotency-Key",
    "x-refresh-token", // keep if you might send refresh in header later
  ],
  optionsSuccessStatus: 204,
  preflightContinue: false,
};

// 👇 add this wrapper RIGHT HERE
if (process.env.NODE_ENV !== "production") {
  const _originFn = corsOptions.origin;
  corsOptions.origin = (origin, cb) => {
    _originFn(origin, (err, ok) => {
      if (err || !ok) console.warn("[CORS BLOCKED]", origin);
      cb(err, ok);
    });
  };
}
