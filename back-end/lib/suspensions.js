// Suspended readers (User.suspended, set on the admin page in routes/admin.js).
// Suspending ends every session and login refuses the account; the helpers here
// keep the rest of the app away from it: its offers leave the market (through
// marketFilter in blocks.js) and nobody can message it or propose a trade to it.
// Trades already under way are left alone.
import { User } from "../Data.js";

export const SUSPENDED_LOGIN_MESSAGE =
  "This account has been suspended. If you think this is a mistake, contact BookBroker.";

// Ids of every suspended reader, as ObjectIds so they also work inside an
// aggregation $match, which does not cast.
export async function suspendedUserIds() {
  return User.find({ suspended: true }).distinct("_id");
}

export async function isSuspended(userId) {
  return Boolean(await User.exists({ _id: userId, suspended: true }));
}
