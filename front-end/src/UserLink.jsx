import { Link } from 'react-router-dom';

// Where a reader's name leads: your own profile, or theirs. Null when there is
// no one to show, e.g. an account that has been deleted.
const profilePath = (user) => {
  const id = user?._id || user?.id;
  if (!id) return null;
  return String(id) === localStorage.getItem('userId') ? '/profile' : `/users/${id}`;
};

// A reader's name, wherever the app shows one, linked to their profile. A reader
// who can't be shown (no id, no name) reads as `fallback`, plain text.
// `className` replaces the default hover-underlined style, e.g. in running text;
// `children` replace the name, e.g. with the reader's initial.
const UserLink = ({ user, fallback = 'Unknown', className = 'user-link', children, ...rest }) => {
  const name = children ?? user?.username;
  const to = profilePath(user);
  if (!name) return fallback;
  if (!to) return name;
  return <Link to={to} className={className} {...rest}>{name}</Link>;
};

export default UserLink;
