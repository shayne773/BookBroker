// Admin access. There are no roles in the database: the admins are the accounts
// whose confirmed email is listed in ADMIN_EMAILS (comma-separated, compared
// case-insensitively). Read on every check, so a changed list applies without a
// migration; an unset or empty list means nobody is an admin.
import { User } from "../Data.js";

export function adminEmails(raw = process.env.ADMIN_EMAILS) {
  return new Set(
    String(raw ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

// A user document with `email` and `emailVerified`. Only a confirmed address
// counts, so nobody becomes an admin by signing up with a listed one.
export function isAdmin(user) {
  if (!user?.email || user.emailVerified === false) return false;
  return adminEmails().has(user.email.toLowerCase());
}

// Route middleware, after authMiddleware: 403 for anyone who is not an admin.
export async function requireAdmin(req, res, next) {
  try {
    const user = await User.findById(req.user.userId).select("email emailVerified").lean();
    if (!isAdmin(user)) return res.status(403).json({ message: "Admins only." });
    next();
  } catch (err) {
    next(err);
  }
}
