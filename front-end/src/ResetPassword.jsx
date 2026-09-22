import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AuthShell from './AuthShell';
import { postPublic, TOKEN_INVALID } from './publicApi';

// Landing page for the link in the password reset email.
export default function ResetPassword() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');
    const [error, setError] = useState('');
    // The link is spent or expired: the form is replaced by a way to get a new one.
    const [linkInvalid, setLinkInvalid] = useState(token ? '' : 'This reset link is incomplete.');
    const [done, setDone] = useState('');
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        const { password, confirm } = e.target.elements;
        if (password.value !== confirm.value) {
            setError('Passwords do not match!');
            return;
        }

        setSaving(true);
        try {
            const { ok, data } = await postPublic('/auth/reset-password', {
                token,
                password: password.value,
            });

            if (ok) {
                setDone(data.message || 'Password updated.');
            } else if (data.code === TOKEN_INVALID) {
                setLinkInvalid(data.message);
            } else {
                setError(data.message || 'Could not update the password. Please try again.');
            }
        } catch (err) {
            console.error('Error resetting password:', err);
            setError('An error occurred. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    if (done) {
        return (
            <AuthShell kicker="Reset password" title="Password updated">
                <div className="stack">
                    <p className="prose" role="status">{done}</p>
                    <Link className="button button--primary button--block" to="/login">Log in</Link>
                </div>
            </AuthShell>
        );
    }

    if (linkInvalid) {
        return (
            <AuthShell kicker="Reset password" title="Link not valid">
                <div className="stack">
                    <p className="notice notice--error" role="alert">{linkInvalid}</p>
                    <Link className="button button--primary button--block" to="/forgot-password">
                        Request a new reset link
                    </Link>
                </div>
            </AuthShell>
        );
    }

    return (
        <AuthShell kicker="Reset password" title="Choose a new password">
            <form className="form" onSubmit={handleSubmit}>
                <p className="hint">At least 8 characters, with an uppercase letter, a lowercase letter and a number.</p>

                <div className="form__row">
                    <label className="field">
                        <span className="field__label">New password</span>
                        <input className="input" type="password" id="password" name="password" placeholder="••••••••" autoComplete="new-password" required />
                    </label>

                    <label className="field">
                        <span className="field__label">Confirm</span>
                        <input className="input" type="password" id="confirm" name="confirm" placeholder="••••••••" autoComplete="new-password" required />
                    </label>
                </div>

                {error && <p className="notice notice--error" role="alert">{error}</p>}

                <button className="button button--primary button--block" type="submit" disabled={saving}>
                    {saving ? 'Saving…' : 'Set new password'}
                </button>
            </form>
        </AuthShell>
    );
}
