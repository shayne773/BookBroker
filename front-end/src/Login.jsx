import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { saveSession } from "./auth";
import AuthShell from "./AuthShell";
import ResendConfirmation from "./ResendConfirmation";
import { EMAIL_NOT_CONFIRMED, postPublic } from "./publicApi";

export default function Login() {
    const [error, setError] = useState('');
    // Set to the address when the account exists but is not confirmed yet.
    const [unconfirmedEmail, setUnconfirmedEmail] = useState('');
    const navigate = useNavigate();
    const location = useLocation();

    // Where RequireAuth wanted to go before it sent us here.
    const from = location.state?.from;
    const redirectTo = from ? `${from.pathname}${from.search || ''}` : '/home';
    const sessionEnded = Boolean(location.state?.sessionEnded);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setUnconfirmedEmail('');

        const { email, password } = e.target.elements;

        try{
            const { ok, data } = await postPublic('/auth/login', {
                email: email.value,
                password: password.value
            });

            if (!ok) {
                if (data.code === EMAIL_NOT_CONFIRMED) setUnconfirmedEmail(email.value.trim());
                setError(data.message || 'Login failed. Please try again.');
                return;
            }

            saveSession({
                token: data.token,
                userId: data.user.id,
                username: data.user.username
            });

            navigate(redirectTo, { replace: true });
        }
        catch (err){
            console.error('Error during login:', err);
            setError('An error occurred. Please try again.');
        }
    };

    return (
        <AuthShell kicker="Welcome back" title="Sign in">
            <form className="form" onSubmit={handleSubmit}>
                {sessionEnded && !error && (
                    <p className="notice" role="status">Your session has ended. Please sign in again.</p>
                )}

                <label className="field">
                    <span className="field__label">Email</span>
                    <input className="input" type="email" id="email" name="email" placeholder="you@example.com" required />
                </label>

                <label className="field">
                    <span className="field__label">Password</span>
                    <input className="input" type="password" id="password" name="password" placeholder="••••••••" required />
                </label>

                <p>
                    <Link className="textlink-quiet" to="/forgot-password">Forgot password?</Link>
                </p>

                {error && <p className="notice notice--error" role="alert">{error}</p>}

                <button className="button button--primary button--block" type="submit">Log in</button>
            </form>

            {unconfirmedEmail && (
                <div className="stack mt-6">
                    <p className="hint">Need a new link? We will send it to {unconfirmedEmail}.</p>
                    <ResendConfirmation email={unconfirmedEmail} />
                </div>
            )}

            <p className="auth__switch">
                <span>New here?</span>
                <a className="textlink" href="/signup">Create an account</a>
            </p>
        </AuthShell>
    )
}