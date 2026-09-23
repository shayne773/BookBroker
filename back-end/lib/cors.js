// CORS allowlist for the BookBroker API.
//
// Allowed browser origins come from the CORS_ALLOWED_ORIGINS environment
// variable as a comma-separated list, e.g.
//
//   CORS_ALLOWED_ORIGINS=https://bookbroker.example.com,https://www.bookbroker.example.com
//
// The deployed site calls the API on its own origin (Vercel serves both, the
// API under /api), and a same-origin request needs no CORS approval. So in
// production an unset variable allows no other origin at all: the site works
// and every cross-origin caller is refused. Outside production it falls back
// to the local development front end, which runs on a different port from the
// API. No deployment hostname is hardcoded here.

export const DEFAULT_DEV_ORIGINS = ["http://localhost:3000"];

export function parseAllowedOrigins(raw) {
  return String(raw ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function resolveAllowedOrigins(env = process.env) {
  const configured = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);
  if (configured.length > 0) return configured;

  if (env.NODE_ENV === "production") return [];
  return [...DEFAULT_DEV_ORIGINS];
}

export function buildCorsOptions(env = process.env) {
  const allowedOrigins = resolveAllowedOrigins(env);

  return {
    allowedOrigins,
    origin(origin, callback) {
      // Requests with no Origin header are not browser cross-origin requests
      // (curl, health checks, server-to-server, same-origin navigations). CORS
      // does not protect those, so rejecting them only breaks tooling.
      if (!origin) return callback(null, true);

      // Disallowed origins get a response with no CORS headers, which the
      // browser blocks. Returning an error here would surface as a 500 instead.
      return callback(null, allowedOrigins.includes(origin));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  };
}
