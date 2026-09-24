import { useState } from "react";
import { Link } from "react-router-dom";
import AuthShell from "./AuthShell";
import ResendConfirmation from "./ResendConfirmation";
import { postPublic } from "./publicApi";
import { normalizeZip, ZIP_FORMAT_MESSAGE } from "./distance";

export default function Signup() {
  const [error, setError] = useState("");
  // The address the confirmation email went to, once the account exists.
  const [sentTo, setSentTo] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const { elements } = e.target;
    const password = elements.password.value;
    const confirmPassword = elements.confirm.value;
    const email = elements.email.value;
    const username = elements.username.value;
    const zip = normalizeZip(elements.zip.value);

    if (password !== confirmPassword) {
      setError("Passwords do not match!");
      return;
    }
    if (!zip) {
      setError(ZIP_FORMAT_MESSAGE);
      return;
    }

    try {
      const { ok, data } = await postPublic("/auth/register", {
        email,
        username,
        password,
        zip,
      });

      if (!ok) {
        setError(data.message || "Signup failed!");
        return;
      }

      setSentTo(email.trim());
    } catch (err) {
      console.error("Error during signup:", err);
      setError("An error occurred. Please try again.");
    }
  };

  if (sentTo) {
    return (
      <AuthShell kicker="One more step" title="Check your email">
        <div className="stack">
          <p className="prose">
            We sent a link to <strong>{sentTo}</strong>. Open it to confirm your address, then
            sign in.
          </p>
          <p className="hint">Nothing arrived? Check your spam folder, or send it again.</p>
          <ResendConfirmation email={sentTo} />
        </div>

        <p className="auth__switch">
          <span>Confirmed already?</span>
          <Link className="textlink" to="/login">
            Log in
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell kicker="Join BookBroker" title="Create your account">
      <form className="form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field__label">Email</span>
          <input className="input" type="email" id="email" name="email" placeholder="you@example.com" required />
        </label>

        <label className="field">
          <span className="field__label">Username</span>
          <input className="input" type="text" id="username" name="username" placeholder="yourname" required />
        </label>

        <div className="form__row">
          <label className="field">
            <span className="field__label">Password</span>
            <input className="input" type="password" id="password" name="password" placeholder="••••••••" required />
          </label>

          <label className="field">
            <span className="field__label">Confirm</span>
            <input className="input" type="password" id="confirm" name="confirm" placeholder="••••••••" required />
          </label>
        </div>

        {/* Trades happen in person, so where you are decides which books you see. */}
        <div className="field">
          <label className="field__label" htmlFor="zip">ZIP code</label>
          <input
            className="input"
            type="text"
            id="zip"
            name="zip"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={10}
            placeholder="11201"
            aria-describedby="zip-hint"
            required
          />
          <span className="hint" id="zip-hint">
            US only. Other readers see your town, never your ZIP code.
          </span>
        </div>

        {error && <p className="notice notice--error" role="alert">{error}</p>}

        <button className="button button--primary button--block" type="submit">
          Sign up
        </button>
      </form>

      <p className="auth__switch">
        <span>Already have an account?</span>
        <a className="textlink" href="/login">
          Log in
        </a>
      </p>
    </AuthShell>
  );
}
