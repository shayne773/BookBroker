import { useState } from "react";
import { Link } from "react-router-dom";
import AuthShell from "./AuthShell";
import ResendConfirmation from "./ResendConfirmation";
import { postPublic } from "./publicApi";

export default function Signup() {
  const [error, setError] = useState("");
  const [location, setLocation] = useState("");
  const [customLocation, setCustomLocation] = useState("");
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

    const finalLocation = location === "Other" ? customLocation.trim() : location;

    if (password !== confirmPassword) {
      setError("Passwords do not match!");
      return;
    }
    if (!finalLocation) {
      setError("Please select or enter your city.");
      return;
    }

    try {
      const { ok, data } = await postPublic("/auth/register", {
        email,
        username,
        password,
        location: finalLocation,
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

        <label className="field">
          <span className="field__label">City</span>
          <select
            className="input"
            id="location"
            name="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            required
          >
            <option value="">--Choose a city--</option>
            <option value="New York">New York, NY</option>
            <option value="Los Angeles">Los Angeles, CA</option>
            <option value="Chicago">Chicago, IL</option>
            <option value="Houston">Houston, TX</option>
            <option value="Phoenix">Phoenix, AZ</option>
            <option value="Philadelphia">Philadelphia, PA</option>
            <option value="San Antonio">San Antonio, TX</option>
            <option value="San Diego">San Diego, CA</option>
            <option value="Dallas">Dallas, TX</option>
            <option value="San Jose">San Jose, CA</option>
            <option value="Austin">Austin, TX</option>
            <option value="Jacksonville">Jacksonville, FL</option>
            <option value="San Francisco">San Francisco, CA</option>
            <option value="Columbus">Columbus, OH</option>
            <option value="Charlotte">Charlotte, NC</option>
            <option value="Indianapolis">Indianapolis, IN</option>
            <option value="Seattle">Seattle, WA</option>
            <option value="Denver">Denver, CO</option>
            <option value="Nashville">Nashville, TN</option>
            <option value="Washington D.C.">Washington, D.C.</option>
            <option value="Other">Other</option>
          </select>
        </label>

        {location === "Other" && (
          <label className="field field--enter">
            <span className="field__label">Enter your city</span>
            <input
              className="input"
              type="text"
              id="customLocation"
              name="customLocation"
              value={customLocation}
              onChange={(e) => setCustomLocation(e.target.value)}
              placeholder="e.g., Champaign, IL"
              required
            />
          </label>
        )}

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
