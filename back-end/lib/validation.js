// Shared input validation / sanitization helpers for the BookBroker API.
import { body, validationResult } from "express-validator";

// Characters that carry special meaning inside a regular expression. User input
// is interpolated into Mongo `$regex` queries in a few places, so it has to be
// escaped first: unescaped input is both an injection vector and a way to feed
// the engine a pattern that backtracks catastrophically.
const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;

export function escapeRegex(value) {
  return String(value ?? "").replace(REGEX_SPECIAL_CHARS, "\\$&");
}

/**
 * Build a safe case-insensitive substring RegExp from user input.
 * @param {string} value raw user input
 */
export function safeRegex(value) {
  return new RegExp(escapeRegex(value), "i");
}

/**
 * Canonical form of an email address, so that `Foo@Example.com` and
 * `foo@example.com` are the same account. Deliberately conservative: we only
 * trim and lowercase, and do not strip dots or `+tags`, which would silently
 * merge addresses the user considers distinct.
 */
export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_REQUIREMENTS_MESSAGE =
  `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include an uppercase letter, a lowercase letter, and a number.`;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
export const LOCATION_MAX_LENGTH = 100;

const emailChain = (field) =>
  body(field)
    .exists({ values: "falsy" })
    .withMessage("Email is required.")
    .bail()
    .isString()
    .withMessage("Email is required.")
    .bail()
    .customSanitizer(normalizeEmail)
    .isEmail()
    .withMessage("Please enter a valid email address.")
    .bail()
    .isLength({ max: 254 })
    .withMessage("Please enter a valid email address.");

// The rules for choosing a password, shared by sign-up and password reset.
const newPasswordChain = (field) =>
  body(field)
    .exists({ values: "falsy" })
    .withMessage("Password is required.")
    .bail()
    .isString()
    .withMessage("Password is required.")
    .bail()
    .isLength({ min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })
    .withMessage(PASSWORD_REQUIREMENTS_MESSAGE)
    .bail()
    .matches(/[a-z]/)
    .withMessage(PASSWORD_REQUIREMENTS_MESSAGE)
    .bail()
    .matches(/[A-Z]/)
    .withMessage(PASSWORD_REQUIREMENTS_MESSAGE)
    .bail()
    .matches(/[0-9]/)
    .withMessage(PASSWORD_REQUIREMENTS_MESSAGE);

export const registerValidators = [
  body("username")
    .exists({ values: "falsy" })
    .withMessage("Username is required.")
    .bail()
    .isString()
    .withMessage("Username is required.")
    .bail()
    .trim()
    .isLength({ min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH })
    .withMessage(
      `Username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters.`
    ),

  emailChain("email"),

  newPasswordChain("password"),

  // The signup form always collects a city and the location-based
  // recommendations are useless without one, so it is required here too.
  body("location")
    .exists({ values: "falsy" })
    .withMessage("City is required.")
    .bail()
    .isString()
    .withMessage("City is required.")
    .bail()
    .trim()
    .isLength({ min: 1, max: LOCATION_MAX_LENGTH })
    .withMessage(`City must be between 1 and ${LOCATION_MAX_LENGTH} characters.`),
];

// The profile form submits the whole user object and leaves fields it is not
// changing blank, so the address is validated only when one is actually sent.
export const userEditValidators = [
  emailChain("user.email").optional({ values: "falsy" }),
];

export const loginValidators = [
  body("email")
    .exists({ values: "falsy" })
    .withMessage("Email is required.")
    .bail()
    .isString()
    .withMessage("Email is required.")
    .bail()
    .customSanitizer(normalizeEmail)
    .isLength({ max: 254 })
    .withMessage("Please enter a valid email address."),

  body("password")
    .exists({ values: "falsy" })
    .withMessage("Password is required.")
    .bail()
    .isString()
    .withMessage("Password is required."),
];

// Resend confirmation and forgot password take only an address.
export const emailOnlyValidators = [emailChain("email")];

export const resetPasswordValidators = [
  body("token")
    .exists({ values: "falsy" })
    .withMessage("This link is missing its token.")
    .bail()
    .isString()
    .withMessage("This link is missing its token.")
    .bail()
    .isLength({ max: 256 })
    .withMessage("This link is missing its token."),
  newPasswordChain("password"),
];

/**
 * Turn express-validator results into a 4xx body that is safe to show a user:
 * only our own `withMessage` text, never the submitted value or an exception.
 * Returns null when the request is valid.
 */
export function validationProblem(req) {
  const result = validationResult(req);
  if (result.isEmpty()) return null;

  const errors = result.array().map((e) => ({
    field: e.path ?? e.param,
    message: e.msg,
  }));

  return { message: errors[0].message, errors };
}
