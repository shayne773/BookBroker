import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { authFetch, isSessionExpiredError } from './auth';
import { reasonLabel } from './reports';
import SuspendDialog from './AdminReports/SuspendDialog';

const server = import.meta.env.VITE_SERVER_ADDRESS;

const FILTERS = [
  ['open', 'Open'],
  ['reviewed', 'Reviewed'],
];

const formatWhen = (d) =>
  new Date(d).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

// Sends an admin request and returns its JSON, throwing the API's message on failure.
async function adminRequest(path, options = {}) {
  const res = await authFetch(`${server}/admin${path}`, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || 'That did not work. Please try again.');
    err.status = res.status;
    throw err;
  }
  return data;
}

// The admin reports page: reports readers have filed, open or reviewed, newest
// first, with a way to mark each reviewed and to suspend or unsuspend the
// reported reader. Only admins (ADMIN_EMAILS on the API) get past the API; anyone
// else is sent home, and nothing in the navigation links here.
const AdminReports = () => {
  const [filter, setFilter] = useState('open');
  const [reports, setReports] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');

  const [suspending, setSuspending] = useState(null); // the reader in the dialog
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    let alive = true;

    adminRequest(`/reports?status=${filter}`)
      .then((data) => alive && setReports(Array.isArray(data) ? data : []))
      .catch((err) => {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err) || !alive) return;
        if (err.status === 403) setForbidden(true);
        else setError('Reports could not be loaded.');
      })
      .finally(() => alive && setLoaded(true));

    return () => {
      alive = false;
    };
  }, [filter]);

  const chooseFilter = (value) => {
    if (value === filter) return;
    setLoaded(false);
    setError('');
    setFilter(value);
  };

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(''), 2500);
  };

  // A reader can be the subject of several reports; each row shows their state.
  const updateReader = (readerId, changes) =>
    setReports((prev) =>
      prev.map((r) =>
        r.reported?._id === readerId ? { ...r, reported: { ...r.reported, ...changes } } : r
      )
    );

  const markReviewed = async (report) => {
    setError('');
    try {
      await adminRequest(`/reports/${report._id}/review`, { method: 'POST' });
      setReports((prev) => prev.filter((r) => r._id !== report._id));
      showToast('Report marked reviewed');
    } catch (err) {
      if (isSessionExpiredError(err)) return;
      setError(err.message);
    }
  };

  const suspend = async (note) => {
    setBusy(true);
    setDialogError('');
    try {
      const data = await adminRequest(`/users/${suspending._id}/suspend`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      });
      updateReader(suspending._id, { suspended: true, suspension: data.suspension });
      showToast(`${suspending.username} is suspended`);
      setSuspending(null);
    } catch (err) {
      if (isSessionExpiredError(err)) return;
      setDialogError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const unsuspend = async (reader) => {
    setError('');
    try {
      await adminRequest(`/users/${reader._id}/suspend`, { method: 'DELETE' });
      updateReader(reader._id, { suspended: false, suspension: undefined });
      showToast(`${reader.username} is no longer suspended`);
    } catch (err) {
      if (isSessionExpiredError(err)) return;
      setError(err.message);
    }
  };

  if (forbidden) return <Navigate to="/home" replace />;

  return (
    <main className="page page--reading">
      <div className="page-head">
        <div className="page-head__main">
          <p className="kicker">Admin</p>
          <h1 className="page-title">Reports</h1>
          <p className="page-lede">
            What readers have reported, newest first. Mark a report reviewed once it is dealt
            with; suspend a reader to keep them out.
          </p>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <div className="segmented" role="group" aria-label="Show reports">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`segmented__option${filter === value ? ' is-active' : ''}`}
                aria-pressed={filter === value}
                onClick={() => chooseFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {loaded && reports.length > 0 && <span className="section-count">{reports.length}</span>}
        </div>

        {error && <p className="notice notice--error mb-4" role="alert">{error}</p>}

        {!loaded && <p className="empty" role="status">Loading…</p>}

        {loaded && !error && reports.length === 0 && (
          <p className="hint">
            {filter === 'open' ? 'No open reports.' : 'No reviewed reports yet.'}
          </p>
        )}

        {loaded && reports.length > 0 && (
          <ul className="list">
            {reports.map((report) => (
              <ReportRow
                key={report._id}
                report={report}
                onReview={() => markReviewed(report)}
                onSuspend={() => {
                  setDialogError('');
                  setSuspending(report.reported);
                }}
                onUnsuspend={() => unsuspend(report.reported)}
              />
            ))}
          </ul>
        )}
      </section>

      {suspending && (
        <SuspendDialog
          user={suspending}
          busy={busy}
          error={dialogError}
          onConfirm={suspend}
          onClose={() => setSuspending(null)}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
};

// One report: who was reported and by whom, why, and what can be done about it.
function ReportRow({ report, onReview, onSuspend, onUnsuspend }) {
  const { reported, reporter } = report;
  const suspended = Boolean(reported?.suspended);
  // Admins cannot suspend themselves; the API refuses it too.
  const isMe = reported?._id === localStorage.getItem('userId');

  return (
    <li className="list-row">
      <span className="avatar" aria-hidden="true">
        {(reported?.username || '?').slice(0, 1)}
      </span>

      <div className="list-row__body">
        <h2 className="list-row__title">
          {reported ? (
            <Link to={`/users/${reported._id}`} className="headline-link">{reported.username}</Link>
          ) : (
            'Deleted reader'
          )}
        </h2>
        <p className="list-row__meta">
          {reasonLabel(report.reason)} · reported by{' '}
          {reporter ? (
            <Link to={`/users/${reporter._id}`} className="textlink-quiet">{reporter.username}</Link>
          ) : (
            'a deleted reader'
          )}{' '}
          · {formatWhen(report.createdAt)}
        </p>

        {report.details && <p className="list-row__text">{report.details}</p>}

        {report.reviewedAt && (
          <p className="list-row__meta">
            Reviewed {formatWhen(report.reviewedAt)}
            {report.reviewedBy ? ` by ${report.reviewedBy.username}` : ''}
          </p>
        )}

        {suspended && reported.suspension?.note && (
          <p className="list-row__meta">Suspension note: {reported.suspension.note}</p>
        )}

        <div className="button-row list-row__extra">
          {!report.reviewedAt && (
            <button type="button" className="button button--secondary button--small" onClick={onReview}>
              Mark reviewed
            </button>
          )}
          {reported && !isMe && (suspended ? (
            <button type="button" className="button button--quiet button--small" onClick={onUnsuspend}>
              Unsuspend {reported.username}
            </button>
          ) : (
            <button type="button" className="button button--quiet button--small" onClick={onSuspend}>
              Suspend {reported.username}
            </button>
          ))}
        </div>
      </div>

      <div className="list-row__trail">
        {suspended && <span className="status">Suspended</span>}
      </div>
    </li>
  );
}

export default AdminReports;
