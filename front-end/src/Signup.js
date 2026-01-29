import "./Login.css";
import "./Signup.css";
import { useState } from "react";

export default function Signup() {
  const [error, setError] = useState("");
  const [location, setLocation] = useState("");
  const [customLocation, setCustomLocation] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const password = e.target.password.value;
    const confirmPassword = e.target.confirm.value;
    const email = e.target.email.value;
    const username = e.target.username.value;

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
      const response = await fetch(`${process.env.REACT_APP_SERVER_ADDRESS}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username, password, location: finalLocation }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.message || "Signup failed!");
        return;
      }

      window.location.href = "/";
    } catch (err) {
      console.error("Error during signup:", err);
      setError("An error occurred. Please try again.");
    }
  };

  return (
    <div className="loginPage">
      <div className="loginCard">
        <div className="appTitle">BookBroker</div>
        <div className="appSubtitle">Create your account</div>

        <form className="loginForm" onSubmit={handleSubmit}>
          <label className="field">
            <span>Email</span>
            <input type="email" id="email" name="email" placeholder="you@example.com" required />
          </label>

          <label className="field">
            <span>Username</span>
            <input type="text" id="username" name="username" placeholder="yourname" required />
          </label>

          <div className="twoCol">
            <label className="field">
              <span>Password</span>
              <input type="password" id="password" name="password" placeholder="••••••••" required />
            </label>

            <label className="field">
              <span>Confirm</span>
              <input type="password" id="confirm" name="confirm" placeholder="••••••••" required />
            </label>
          </div>

          <label className="field">
            <span>City</span>
            <select
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
            <label className="field slideDown">
              <span>Enter your city</span>
              <input
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

          {error && <div className="errorBox">{error}</div>}

          <button className="primaryBtn" type="submit">
            Sign up
          </button>

          <div className="footerRow">
            <span>Already have an account?</span>
            <a className="link" href="/login">
              Log in
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
