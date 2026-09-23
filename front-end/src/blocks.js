import { authFetch } from './auth';

// Places or lifts the caller's block on a reader. Resolves to whether the reader
// is now blocked; rejects with the server's message on a refusal.
export const setBlocked = async (userId, blocked) => {
  const res = await authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/users/${userId}/block`, {
    method: blocked ? 'POST' : 'DELETE',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'That did not go through. Please try again.');
  return data.blockedByMe;
};
