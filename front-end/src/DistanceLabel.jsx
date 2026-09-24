import { formatDistance } from './distance';

// A book's distance from you, when the API sent one.
const DistanceLabel = ({ miles, label, block = false }) => {
  const text = formatDistance(miles, label);
  if (!text) return null;
  return <span className={block ? 'distance block' : 'distance'}>{text}</span>;
};

export default DistanceLabel;
