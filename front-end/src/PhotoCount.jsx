import { photoCountLabel } from './photos';

// How many photos a book's owner has added, beside the book in a list: the
// catalogue cover stays the thumbnail, and the photos are on the book's page.
// Nothing for a book without any.
const PhotoCount = ({ count, block = false }) => {
  const label = photoCountLabel(count);
  if (!label) return null;
  return <span className={block ? 'photo-count block' : 'photo-count'}>{label}</span>;
};

export default PhotoCount;
