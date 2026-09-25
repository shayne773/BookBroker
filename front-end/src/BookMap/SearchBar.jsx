import { useState } from 'react';
import { LISTED_CHOICES } from '../mapSearch';

// The search over the map: a keyword and the filters. Typed terms apply when
// the form is sent; a choice (genre, when listed, wishlist) applies at once,
// with whatever has been typed. Keyed by the search in force, so a new one
// (or one read from the URL) starts the form afresh.
const SearchBar = ({ search, active, genres, onSearch, onClear }) => {
  const [draft, setDraft] = useState(search);

  const type = (key) => (event) => setDraft({ ...draft, [key]: event.target.value });
  const choose = (key, value) => onSearch({ ...draft, [key]: value });

  // A genre in the URL that the market no longer has is still shown as chosen.
  const genreChoices = search.genre && !genres.includes(search.genre) ? [search.genre, ...genres] : genres;

  return (
    <form
      className="map-search"
      role="search"
      aria-label="Search the map"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(draft);
      }}
    >
      <div className="map-search__row">
        <input
          type="search"
          className="input map-search__keyword"
          placeholder="Search by title, author, publisher or ISBN"
          aria-label="Keyword"
          maxLength={100}
          value={draft.q}
          onChange={type('q')}
        />
        <button type="submit" className="button button--primary button--small">
          Search
        </button>
        {active && (
          <button type="button" className="button button--quiet button--small" onClick={onClear}>
            Clear
          </button>
        )}
      </div>

      <div className="map-search__filters">
        <label className="field map-search__field">
          <span className="field__label">Genre</span>
          <select className="input" value={draft.genre} onChange={(event) => choose('genre', event.target.value)}>
            <option value="">Any genre</option>
            {genreChoices.map((genre) => (
              <option key={genre} value={genre}>
                {genre}
              </option>
            ))}
          </select>
        </label>

        <label className="field map-search__field">
          <span className="field__label">Author</span>
          <input className="input" maxLength={100} value={draft.author} onChange={type('author')} />
        </label>

        <div className="field map-search__field" role="group" aria-labelledby="map-search-years">
          <span id="map-search-years" className="field__label">Published</span>
          <div className="map-search__years">
            <input
              className="input"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              placeholder="From"
              aria-label="Published from"
              title="A four-digit year"
              value={draft.from}
              onChange={type('from')}
            />
            <span aria-hidden="true">&ndash;</span>
            <input
              className="input"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              placeholder="To"
              aria-label="Published to"
              title="A four-digit year"
              value={draft.to}
              onChange={type('to')}
            />
          </div>
        </div>

        <label className="field map-search__field">
          <span className="field__label">Listed</span>
          <select className="input" value={draft.listed} onChange={(event) => choose('listed', event.target.value)}>
            {LISTED_CHOICES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="map-search__check">
          <input
            type="checkbox"
            checked={draft.wishlist}
            onChange={(event) => choose('wishlist', event.target.checked)}
          />
          Only my wishlist matches
        </label>
      </div>
    </form>
  );
};

export default SearchBar;
