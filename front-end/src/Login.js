import './Login.css';
import { useState } from "react";  

export default function Login() {
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();

        const password = e.target.password.value;
        const email = e.target.email.value;

        try{
            const response = await fetch(`${process.env.REACT_APP_SERVER_ADDRESS}/auth/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ email, password })
            })
            
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Login failed');
            }

            localStorage.setItem('token', data.token);
            localStorage.setItem('userId', data.user.id);
            localStorage.setItem('username', data.user.username);

            window.location.href = "/home";
        }
        catch (err){
            console.log(err)
            setError(err.message)
        }

        setError('');
        console.log('Form submitted successfully!');
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