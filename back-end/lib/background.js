// Work that finishes after the response has gone out, such as sending mail.
//
// Every such promise goes through runInBackground. On Vercel an instance can be
// frozen as soon as the response is sent, so the promise is handed to
// waitUntil, which keeps the invocation alive until it settles; outside Vercel
// waitUntil is a no-op and the process simply carries on. A failure is logged,
// never thrown, since nobody is left to answer.

import { waitUntil } from "@vercel/functions";

export function runInBackground(work, what) {
  waitUntil(work.catch((err) => console.error(`Failed to ${what}:`, err)));
}
