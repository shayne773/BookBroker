import { formatDistance } from './distance';

// A book's or reader's distance from you, when the API sent one.
const DistanceLabel = ({ miles, block = false }) => {
  const text = formatDistance(miles);
  if (!text) return null;
  return <span className={block ? 'distance block' : 'distance'}>{text}</span>;
};

export default DistanceLabel;
