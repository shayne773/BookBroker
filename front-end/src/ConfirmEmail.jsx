import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AuthShell from './AuthShell';
import ResendConfirmation from './ResendConfirmation';
import { postPublic } from './publicApi';

// Landing page for the link in the confirmation email. The token works once, so
// it is sent once: the ref keeps a second effect run (React's development
// double-mount) from spending it and reporting the link as used.
export default function ConfirmEmail() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');
    const [state, setState] = useState(token ? { status: 'pending' } : {
        status: 'failed',
        message: 'This confirmation link is incomplete.',
    });
    const sent = useRef(false);

    useEffect(() => {
        if (!token || sent.current) return;
        sent.current = true;

        postPublic('/auth/confirm-email', { token })
            .then(({ ok, data }) => setState(ok
                ? { status: 'confirmed', message: data.message }
                : { status: 'failed', message: data.message || 'This confirmation link did not work.' }))
            .catch((err) => {
                console.error('Error confirming email:', err);
                setState({ status: 'failed', message: 'An error occurred. Please try again.' });
            });
    }, [token]);

    if (state.status === 'pending') {
        return (
            <AuthShell kicker="Confirm email" title="Confirming…">
                <p className="hint" role="status">Checking your link.</p>
            </AuthShell>
        );
    }

    if (state.status === 'confirmed') {
        return (
            <AuthShell kicker="Confirm email" title="Email confirmed">
                <div className="stack">
                    <p className="prose">{state.message || 'Your address is confirmed.'}</p>
                    <Link className="button button--primary button--block" to="/login">Log in</Link>
                </div>
            </AuthShell>
        );
    }

    return (
        <AuthShell kicker="Confirm email" title="Link not valid">
            <div className="stack">
                <p className="notice notice--error" role="alert">{state.message}</p>
                <p className="hint">Enter your email and we will send a new confirmation link.</p>
                <ResendConfirmation />
            </div>

            <p className="auth__switch">
                <span>Already confirmed?</span>
                <Link className="textlink" to="/login">Log in</Link>
            </p>
        </AuthShell>
    );
}
