import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthShell from './AuthShell';
import { postPublic } from './publicApi';

export default function ForgotPassword() {
    const [error, setError] = useState('');
    const [sent, setSent] = useState('');
    const [sending, setSending] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSending(true);

        try {
            const { ok, data } = await postPublic('/auth/forgot-password', {
                email: e.target.elements.email.value,
            });

            if (!ok) {
                setError(data.message || 'Could not send the email. Please try again.');
                return;
            }
            setSent(data.message || 'If an account uses that address, we have sent it a reset link.');
        } catch (err) {
            console.error('Error requesting a password reset:', err);
            setError('An error occurred. Please try again.');
        } finally {
            setSending(false);
        }
    };

    return (
        <AuthShell kicker="Forgot password" title={sent ? 'Check your email' : 'Reset your password'}>
            {sent ? (
                <div className="stack">
                    <p className="prose" role="status">{sent}</p>
                    <p className="hint">The link works once and expires after an hour.</p>
                </div>
            ) : (
                <form className="form" onSubmit={handleSubmit}>
                    <p className="hint">Enter the email you signed up with and we will send you a link to choose a new password.</p>

                    <label className="field">
                        <span className="field__label">Email</span>
                        <input className="input" type="email" id="email" name="email" placeholder="you@example.com" required />
                    </label>

                    {error && <p className="notice notice--error" role="alert">{error}</p>}

                    <button className="button button--primary button--block" type="submit" disabled={sending}>
                        {sending ? 'Sending…' : 'Send reset link'}
                    </button>
                </form>
            )}

            <p className="auth__switch">
                <span>Remembered it?</span>
                <Link className="textlink" to="/login">Log in</Link>
            </p>
        </AuthShell>
    );
}
