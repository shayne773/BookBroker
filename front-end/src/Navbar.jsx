import { Link, NavLink, useLocation } from 'react-router-dom';
import useAccountPrompt from './useAccountPrompt';
import { useUnreadCount } from './unread';

// The top bar: wordmark on the left, text links on the right, a hairline rule
// beneath. Styling lives in the design system (styles/components.css) rather
// than in a stylesheet of its own. `action` marks the pages that need an
// account: for a visitor their links stay in view and ask them to sign up.
const LINKS = [
  { to: '/home', label: 'Home' },
  { to: '/browse', label: 'Browse' },
  { to: '/map', label: 'Map' },
  { to: '/exchanges', label: 'Exchanges', action: 'trade books' },
  { to: '/messages', label: 'Messages', action: 'message readers' },
  { to: '/profile', label: 'Profile', action: 'keep a profile' },
];

// NavLink sets aria-current="page" on the active link itself, so the current
// page is announced as well as underlined. Messages carries the number of
// conversations waiting to be read, kept fresh by a slow poll (unread.js). A
// visitor also gets a way to sign in, which brings them back to this page.
const Navbar = () => {
  const location = useLocation();
  const { signedIn, gate } = useAccountPrompt();
  const unread = useUnreadCount(signedIn);

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to="/home" className="wordmark">
          BookBroker
        </Link>

        <nav className="site-nav" aria-label="Primary">
          {LINKS.map(({ to, label, action }) => (
            <NavLink
              key={to}
              to={to}
              onClick={action ? gate(action, () => {}) : undefined}
              className={({ isActive }) =>
                `site-nav__link${isActive ? ' is-current' : ''}`
              }
            >
              {label}
              {to === '/messages' && unread > 0 && (
                <>
                  <span className="site-nav__count" aria-hidden="true">{unread}</span>
                  <span className="visually-hidden">
                    {unread} unread {unread === 1 ? 'conversation' : 'conversations'}
                  </span>
                </>
              )}
            </NavLink>
          ))}
          {!signedIn && (
            <Link to="/login" state={{ from: location }} className="site-nav__link">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
};

export default Navbar;
