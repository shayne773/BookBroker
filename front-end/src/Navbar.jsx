import { Link, NavLink } from 'react-router-dom';

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
// page is announced as well as underlined.
const Navbar = () => (
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
          </NavLink>
        ))}
      </nav>
    </div>
  </header>
);

export default Navbar;
