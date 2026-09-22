import { useState } from 'react';
import { postPublic } from './publicApi';

// Asks the API to email a fresh confirmation link. With a known `email` it is a
// single button; without one it asks for the address first.
export default function ResendConfirmation({ email }) {
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSending(true);
        setResult(null);

        const address = email ?? e.target.elements.email.value;

        try {
            const { ok, data } = await postPublic('/auth/resend-confirmation', { email: address });
            setResult({
                ok,
                message: data.message || (ok ? 'Confirmation email sent.' : 'Could not send the email. Please try again.'),
            });
        } catch (err) {
            console.error('Error resending confirmation:', err);
            setResult({ ok: false, message: 'An error occurred. Please try again.' });
        } finally {
            setSending(false);
        }
    };

    return (
        <form className="form" onSubmit={handleSubmit}>
            {!email && (
                <label className="field">
                    <span className="field__label">Email</span>
                    <input className="input" type="email" name="email" placeholder="you@example.com" required />
                </label>
            )}

            {result && (
                <p className={result.ok ? 'notice' : 'notice notice--error'} role={result.ok ? 'status' : 'alert'}>
                    {result.message}
                </p>
            )}

            <button className="button button--secondary button--block" type="submit" disabled={sending}>
                {sending ? 'Sending…' : 'Resend confirmation email'}
            </button>
        </form>
    );
}
