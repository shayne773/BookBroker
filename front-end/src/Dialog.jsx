import { useEffect, useId } from 'react';

// A hand-built modal on the shared .dialog-* classes. It closes from the scrim,
// the close button and the Escape key; focus moves to the close button as it opens.
const Dialog = ({ title, onClose, children }) => {
  const titleId = useId();

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog__head">
          <h2 className="dialog__title" id={titleId}>{title}</h2>
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Close" autoFocus>
            &#10005;
          </button>
        </div>

        {children}
      </div>
    </div>
  );
};

export default Dialog;
