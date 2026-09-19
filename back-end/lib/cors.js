// CORS allowlist for the BookBroker API.
//
// Allowed browser origins come from the CORS_ALLOWED_ORIGINS environment
// variable as a comma-separated list, e.g.
//
//   CORS_ALLOWED_ORIGINS=https://bookbroker.example.com,https://www.bookbroker.example.com
//
// Outside production, an unset variable falls back to the local development
// front end only, so a misconfigured process fails closed instead of accepting
// every origin on the internet. In production the variable is required: the API
// refuses to start without it rather than serving an origin that is not the
// deployed front end. No deployment hostname is hardcoded here.

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

  if (env.NODE_ENV === "production") {
    throw new Error(
      "CORS_ALLOWED_ORIGINS must be set in production. " +
        "Set it to the deployed front-end origin(s) before starting the API."
    );
  }
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

      const normalized = origin.replace(/\/+$/, "");
      // Disallowed origins get a response with no CORS headers, which the
      // browser blocks. Returning an error here would surface as a 500 instead.
      return callback(null, allowedOrigins.includes(normalized));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  };
}
