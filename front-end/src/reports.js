// The reasons a reader can give for a report (REPORT_REASONS in back-end/Data.js),
// with the words the report dialog and the admin reports page show for them.
export const REPORT_REASONS = [
  ['SPAM', 'Spam or advertising'],
  ['HARASSMENT', 'Harassment or abuse'],
  ['SCAM', 'Scam or fraud'],
  ['NO_SHOW', "Didn't follow through on a trade"],
  ['INAPPROPRIATE', 'Inappropriate content'],
  ['OTHER', 'Something else'],
];

const LABELS = new Map(REPORT_REASONS);

export const reasonLabel = (reason) => LABELS.get(reason) || reason;
