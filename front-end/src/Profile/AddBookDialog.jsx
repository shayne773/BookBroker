import { useId } from 'react';
import { GoogleSuggestions } from '../Browse/SearchResults';

// Search Google Books and add the chosen volume to a shelf. The search state
// lives in the caller (see useBookSearch) so it outlasts the dialog. `error`
// says why the last add failed.
const AddBookDialog = ({ title, search, error, onSubmit, onClose }) => {
  const titleId = useId();
  const inputId = useId();

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
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <form className="form" onSubmit={onSubmit}>
          <div className="field field-anchor">
            <label className="field__label" htmlFor={inputId}>Search for a book</label>
            <input
              id={inputId}
              className="input"
              type="text"
              value={search.text}
              onChange={(e) => search.type(e.target.value)}
              placeholder="Type book name..."
              autoComplete="off"
              autoFocus
            />

            {search.results.length > 0 && (
              <GoogleSuggestions results={search.results} onPick={(book) => search.pick(book)} />
            )}
          </div>

          {search.searching && <p className="hint" role="status">Searching…</p>}
          {search.error && <p className="notice notice--error" role="alert">{search.error}</p>}
          {error && <p className="notice notice--error" role="alert">{error}</p>}

          <div className="dialog__foot">
            <button type="button" className="button button--quiet" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button button--primary" disabled={!search.selected}>
              Add
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddBookDialog;
