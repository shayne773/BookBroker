import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { saveSession } from "./auth";
import AuthShell from "./AuthShell";

export default function Login() {
    const [error, setError] = useState('');
    const navigate = useNavigate();
    const location = useLocation();

    // Where RequireAuth wanted to go before it sent us here.
    const from = location.state?.from;
    const redirectTo = from ? `${from.pathname}${from.search || ''}` : '/home';

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        const { email, password } = e.target.elements;

        try{
            const response = await fetch(`${import.meta.env.VITE_SERVER_ADDRESS}/auth/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ email: email.value, password: password.value })
            })
            
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
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
                <label className="field">
                    <span className="field__label">Email</span>
                    <input className="input" type="email" id="email" name="email" placeholder="you@example.com" required />
                </label>

                <label className="field">
                    <span className="field__label">Password</span>
                    <input className="input" type="password" id="password" name="password" placeholder="••••••••" required />
                </label>

                {error && <p className="notice notice--error" role="alert">{error}</p>}

                <button className="button button--primary button--block" type="submit">Log in</button>
            </form>

            <p className="auth__switch">
                <span>New here?</span>
                <a className="textlink" href="/signup">Create an account</a>
            </p>
        </AuthShell>
    )
}