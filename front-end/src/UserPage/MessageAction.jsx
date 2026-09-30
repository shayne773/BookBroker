import { Link } from 'react-router-dom';
import useAccountPrompt from '../useAccountPrompt';

// "Message" on another reader's page, which opens your conversation with them
// (an empty one if you have never written). Nothing on your own page; while you
// block them it stays in view, disabled, saying why. A visitor is asked to sign up.
const MessageAction = ({ user }) => {
  const { gate } = useAccountPrompt();

  if (!user?._id || String(user._id) === localStorage.getItem('userId')) return null;

  if (user.blockedByMe) {
    return (
      <>
        <span id="message-blocked" className="hint">Unblock {user.username} to message them</span>
        <button type="button" className="button button--primary" disabled aria-describedby="message-blocked">
          Message
        </button>
      </>
    );
  }

  return (
    <Link
      to={`/messages/${user._id}`}
      className="button button--primary"
      onClick={gate('message readers', () => {})}
    >
      Message
    </Link>
  );
};

export default MessageAction;
