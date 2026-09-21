import Popup from 'reactjs-popup';

// The account details form, opened from the profile head. The city choice is
// held by Profile, so it survives the popup closing.
const EditProfileDialog = ({ location, setLocation, customLocation, setCustomLocation, onSubmit }) => (
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

          <label className="field">
            <span className="field__label">City</span>
            <select
              className="input"
              id="location"
              name="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            >
              <option value="">--Choose a city--</option>
              <option value="New York">New York, NY</option>
              <option value="Los Angeles">Los Angeles, CA</option>
              <option value="Other">Other</option>
            </select>
          </label>

          {location === 'Other' && (
            <label className="field field--enter">
              <span className="field__label">Enter your city</span>
              <input
                className="input"
                type="text"
                id="customLocation"
                name="customLocation"
                value={customLocation}
                onChange={(e) => setCustomLocation(e.target.value)}
                required
              />
            </label>
          )}

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
