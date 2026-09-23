import { useEffect, useRef } from 'react';

// Short polling that suits a serverless API: `poll` runs every `interval` ms
// while the tab is visible, every `hiddenInterval` ms while it is hidden (or not
// at all when that is null), and once straight away when the tab comes back.
// Runs never overlap: the next one is scheduled when the last one settles.
// The first run is left to the caller, which usually loads the page's data itself.
export default function usePolling(poll, { interval, hiddenInterval = null, enabled = true }) {
  const pollRef = useRef(poll);
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useEffect(() => {
    if (!enabled) return undefined;

    let timer = null;
    let running = false;
    let stopped = false;

    const delay = () => (document.visibilityState === 'hidden' ? hiddenInterval : interval);

    const schedule = () => {
      clearTimeout(timer);
      timer = null;
      const ms = delay();
      if (!stopped && ms != null) timer = setTimeout(run, ms);
    };

    const run = async () => {
      if (running) return;
      running = true;
      try {
        await pollRef.current();
      } catch {
        // A failed poll is retried on the next tick; the page keeps what it has.
      } finally {
        running = false;
        schedule();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') run();
      else schedule();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [interval, hiddenInterval, enabled]);
}
