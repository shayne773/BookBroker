// The head of a reader's page - your own profile or someone else's: their
// initial, their name, and the account facts in a row beneath.
const ProfileHead = ({ kicker, user, children }) => (
  <>
    <div className="page-head">
      <div className="page-head__main person">
        <span className="avatar avatar--large" aria-hidden="true">
          {(user?.username?.[0] || '?').toUpperCase()}
        </span>

        <div className="person__text">
          <p className="kicker">{kicker}</p>
          <h1 className="page-title">{user?.username || 'Profile'}</h1>
        </div>
      </div>

      {children && <div className="page-head__aside">{children}</div>}
    </div>

    <dl className="facts facts--row">
      <div>
        <dt className="fact__term">Email</dt>
        <dd className="fact__value">{user?.email}</dd>
        {user?.pendingEmail && (
          <dd className="hint">Waiting for confirmation: {user.pendingEmail}</dd>
        )}
      </div>
      <div>
        <dt className="fact__term">Location</dt>
        <dd className="fact__value">{user?.location ?? 'N/A'}</dd>
      </div>
      <div>
        <dt className="fact__term">Rating</dt>
        <dd className="fact__value">{user?.ratings}</dd>
      </div>
    </dl>
  </>
);

export default ProfileHead;
