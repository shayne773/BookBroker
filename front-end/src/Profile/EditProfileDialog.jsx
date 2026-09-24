import Popup from 'reactjs-popup';

// The account details form, opened from the profile head. Where the reader
// trades is set in its own section of the profile (LocationSettings).
const EditProfileDialog = ({ onSubmit }) => (
  <Popup
    trigger={<button type="button" className="button button--secondary">Edit profile</button>}
    modal
    className="dialog"
  >
    {(close) => (
      <>
        <div className="dialog__head">
          <h2 className="dialog__title">Edit profile</h2>
          <button type="button" className="dialog__close" onClick={close} aria-label="Close">
            &#10005;
          </button>
        </div>

        <form className="form" onSubmit={(e) => onSubmit(e, close)}>
          <label className="field">
            <span className="field__label">Username</span>
            <input className="input" type="text" name="username" id="username" />
          </label>

          <label className="field">
            <span className="field__label">Email</span>
            <input className="input" type="text" name="email" id="email" />
          </label>

          <div className="dialog__foot">
            <button type="button" className="button button--quiet" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="button button--primary">Save</button>
          </div>
        </form>
      </>
    )}
  </Popup>
);

export default EditProfileDialog;
