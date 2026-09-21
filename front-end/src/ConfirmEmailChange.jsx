import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AuthShell from './AuthShell';
import { postPublic } from './publicApi';

// Landing page for the link mailed to a new address from the profile. The token
// works once, so the ref keeps React's development double-mount from spending it.
export default function ConfirmEmailChange() {
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

        postPublic('/auth/confirm-email-change', { token })
            .then(({ ok, data }) => setState(ok
                ? { status: 'confirmed', message: data.message }
                : { status: 'failed', message: data.message || 'This confirmation link did not work.' }))
            .catch((err) => {
                console.error('Error confirming email change:', err);
                setState({ status: 'failed', message: 'An error occurred. Please try again.' });
            });
    }, [token]);

    if (state.status === 'pending') {
        return (
            <AuthShell kicker="Change email" title="Confirming…">
                <p className="hint" role="status">Checking your link.</p>
            </AuthShell>
        );
    }

    if (state.status === 'confirmed') {
        return (
            <AuthShell kicker="Change email" title="Email changed">
                <div className="stack">
                    <p className="prose">{state.message || 'Your new address is confirmed.'}</p>
                    <Link className="button button--primary button--block" to="/login">Log in</Link>
                </div>
            </AuthShell>
        );
    }

    return (
        <AuthShell kicker="Change email" title="Link not valid">
            <div className="stack">
                <p className="notice notice--error" role="alert">{state.message}</p>
                <p className="hint">Your email has not changed. Ask for a new link from your profile.</p>
            </div>

            <p className="auth__switch">
                <Link className="textlink" to="/login">Log in</Link>
            </p>
        </AuthShell>
    );
}
