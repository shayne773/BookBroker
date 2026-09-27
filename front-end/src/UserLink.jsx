import { Link } from 'react-router-dom';

// Where a reader's name leads: your own profile, or theirs. Null when there is
// no one to show, e.g. an account that has been deleted.
const profilePath = (user) => {
  const id = user?._id || user?.id;
  if (!id) return null;
  return String(id) === localStorage.getItem('userId') ? '/profile' : `/users/${id}`;
};

// A reader's name, wherever the app shows one, linked to their profile. A reader
// the API sends no name for (null, or `username: null`) has deleted their
// account, and reads as `fallback`, plain text with no link.
// `className` replaces the default hover-underlined style, e.g. in running text;
// `children` replace the name, e.g. with the reader's initial.
const UserLink = ({ user, fallback = 'Deleted reader', className = 'user-link', children, ...rest }) => {
  if (!user?.username) return fallback;
  const name = children ?? user.username;
  const to = profilePath(user);
  if (!to) return name;
  return <Link to={to} className={className} {...rest}>{name}</Link>;
};

export default UserLink;
