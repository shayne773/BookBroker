// The frame both sign-in screens share: an ink panel with the wordmark and one
// line of copy, and the form on paper beside it. The screens carry no top
// navigation (AppContent hides it on these routes), so the wordmark lives here.
const AuthShell = ({ kicker, title, children }) => (
  <div className="auth">
    <aside className="auth__aside">
      <p className="wordmark">BookBroker</p>

      <p className="auth__headline">Pass on the books you have read.</p>

      <p className="auth__note">A book exchange between readers.</p>
    </aside>

    <main className="auth__main">
      <div className="auth__form">
        <p className="kicker">{kicker}</p>
        <h1 className="page-title">{title}</h1>

        {children}
      </div>
    </main>
  </div>
);

export default AuthShell;
