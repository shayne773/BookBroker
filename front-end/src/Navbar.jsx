import { Link, NavLink } from 'react-router-dom';
import { getToken } from './auth';
import { useUnreadCount } from './unread';

// The top bar: wordmark on the left, text links on the right, a hairline rule
// beneath. Styling lives in the design system (styles/components.css) rather
// than in a stylesheet of its own.
const LINKS = [
  { to: '/home', label: 'Home' },
  { to: '/browse', label: 'Browse' },
  { to: '/exchanges', label: 'Exchanges' },
  { to: '/messages', label: 'Messages' },
  { to: '/profile', label: 'Profile' },
];

// NavLink sets aria-current="page" on the active link itself, so the current
// page is announced as well as underlined. Messages carries the number of
// conversations waiting to be read, kept fresh by a slow poll (unread.js).
const Navbar = () => {
  const unread = useUnreadCount(Boolean(getToken()));

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to="/home" className="wordmark">
          BookBroker
        </Link>

        <nav className="site-nav" aria-label="Primary">
          {LINKS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
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
        </nav>
      </div>
    </header>
  );
};

export default Navbar;
