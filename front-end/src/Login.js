import './Login.css';
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { saveSession } from "./auth";

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
            const response = await fetch(`${process.env.REACT_APP_SERVER_ADDRESS}/auth/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ email: email.value, password: password.value })
            })
            
            const data = await response.json().catch(() => ({}));

            if (!response.ok || !data.token) {
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
        <div className="loginPage">
            <div className="loginCard">
                <div className="appTitle">BookBroker</div>
                <div className="appSubtitle">Sign in to continue</div>

                <form className="loginForm" onSubmit={handleSubmit}>
                    <label className="field">
                    <span>Email</span>
                    <input type="email" id="email" name="email" placeholder="you@example.com" required />
                    </label>

                    <label className="field">
                    <span>Password</span>
                    <input type="password" id="password" name="password" placeholder="••••••••" required />
                    </label>

                    {error && <div className="errorBox">{error}</div>}

                    <button className="primaryBtn" type="submit">Log in</button>

                    <div className="footerRow">
                    <span>New here?</span>
                    <a className="link" href="/signup">Create an account</a>
                    </div>
                </form>
            </div>
        </div>
    )
}