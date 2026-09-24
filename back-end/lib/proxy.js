// Express "trust proxy" setting, which decides whether req.ip is read from
// X-Forwarded-For.
//
// Behind a load balancer every request arrives from the balancer's address, so
// the per-client limits need the caller's address from the header. TRUST_PROXY
// sets it explicitly. On Vercel (which sets VERCEL) it defaults to 1, since
// Vercel's edge overwrites X-Forwarded-For with the caller's address. Anywhere
// else it is left off: the header is ignored, since anyone can forge it.

export function trustProxySetting(env = process.env) {
  const raw = env.TRUST_PROXY?.trim();
  if (!raw) return env.VERCEL ? 1 : false;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === "true" || raw === "false") return raw === "true";
  return raw;
}
