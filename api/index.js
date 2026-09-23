// Vercel serves each file under api/ as a function. This is the only one: the
// Express API from back-end/, which vercel.json routes every /api/* request to.
export { default } from "../back-end/vercel.js";
