// Placeholders in the shape of the content that is coming, so a screen keeps
// its layout while it loads. Each announces itself once to a screen reader and
// is otherwise decoration. Pass one as an Appear's `placeholder`.
const Placeholder = ({ children }) => (
  <div className="placeholder" role="status">
    <span className="visually-hidden">Loading…</span>
    <div aria-hidden="true">{children}</div>
  </div>
);

const times = (count, render) => Array.from({ length: count }, (_, i) => render(i));

// A .book-grid of covers; `variant` is the grid's modifier class.
export const BookGridSkeleton = ({ count = 6, variant = '' }) => (
  <Placeholder>
    <div className={`book-grid ${variant}`}>
      {times(count, (i) => (
        <div key={i} className="stack">
          <div className="skeleton skeleton--cover" />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line skeleton--line-short" />
        </div>
      ))}
    </div>
  </Placeholder>
);

// The rows of a .book-list, or with `small` of a list with smaller rows.
export const BookListSkeleton = ({ count = 4, small = false, className = 'book-list' }) => (
  <Placeholder>
    <div className={className}>
      {times(count, (i) => (
        <div key={i} className={`skeleton-row${small ? ' skeleton-row--small' : ''}`}>
          <div className="skeleton skeleton--cover" />
          <div className="stack">
            <div className="skeleton skeleton--line" />
            <div className="skeleton skeleton--line skeleton--line-short" />
          </div>
        </div>
      ))}
    </div>
  </Placeholder>
);

// Lines of text on their way, e.g. a list with no covers.
export const LinesSkeleton = ({ count = 4 }) => (
  <Placeholder>
    <div className="stack section">
      {times(count, (i) => (
        <div key={i} className={`skeleton skeleton--line${i % 2 ? ' skeleton--line-short' : ''}`} />
      ))}
    </div>
  </Placeholder>
);

// Home's lead story.
export const LeadSkeleton = () => (
  <Placeholder>
    <div className="lead">
      <div className="lead__cover skeleton skeleton--cover" />
      <div className="stack">
        <div className="skeleton skeleton--title" />
        <div className="skeleton skeleton--line skeleton--line-short" />
        <div className="skeleton skeleton--line" />
        <div className="skeleton skeleton--line" />
      </div>
    </div>
  </Placeholder>
);

// A book's own page.
export const BookPageSkeleton = () => (
  <Placeholder>
    <div className="book">
      <div className="book__head stack">
        <div className="skeleton skeleton--line skeleton--line-short" />
        <div className="skeleton skeleton--title" />
      </div>
      <div className="book__body">
        <div className="skeleton skeleton--cover" />
        <div className="stack">
          <div className="skeleton skeleton--line skeleton--line-short" />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line skeleton--line-short" />
        </div>
      </div>
    </div>
  </Placeholder>
);
