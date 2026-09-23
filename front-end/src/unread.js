import { useEffect, useSyncExternalStore } from 'react';
import { authFetch, getToken } from './auth';
import usePolling from './usePolling';

// How many conversations hold a message the signed-in user has not read. One
// shared value, so the navigation bar and the pages that mark conversations
// read agree without each polling for it.
const UNREAD_INTERVAL = 30000;

let unreadConversations = 0;
const listeners = new Set();

function setUnread(count) {
  if (count === unreadConversations) return;
  unreadConversations = count;
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => unreadConversations;

// Asks the server for the count. Pages call it after marking a conversation
// read, so the navigation bar catches up at once instead of on its next poll.
export async function refreshUnread() {
  if (!getToken()) {
    setUnread(0);
    return;
  }
  const res = await authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/messages/unread`);
  if (!res.ok) return;
  const data = await res.json();
  setUnread(Number(data?.conversations) || 0);
}

// The live count, polled slowly while the tab is visible and not at all while
// it is hidden. `enabled` is false where nobody is signed in.
export function useUnreadCount(enabled = true) {
  useEffect(() => {
    if (enabled) refreshUnread().catch(() => {});
    else setUnread(0);
  }, [enabled]);

  usePolling(refreshUnread, { interval: UNREAD_INTERVAL, enabled });

  return useSyncExternalStore(subscribe, snapshot);
}
