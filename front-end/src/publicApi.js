// POST to one of the API's public (signed-out) endpoints: sign-up, sign-in and
// the email confirmation and password reset flows. Signed-in requests go
// through authFetch in auth.js instead.
export const postPublic = async (path, body) => {
  const response = await fetch(`${import.meta.env.VITE_SERVER_ADDRESS}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
};

// Error codes the API attaches to the responses a page acts on.
export const EMAIL_NOT_CONFIRMED = 'EMAIL_NOT_CONFIRMED';
export const TOKEN_INVALID = 'TOKEN_INVALID';
