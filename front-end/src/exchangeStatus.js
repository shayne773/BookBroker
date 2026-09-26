// How an exchange's status is named and drawn, shared by the list and the detail page.

export function statusLabel(s) {
  const map = {
    DRAFT: "Draft",
    PENDING: "Pending",
    COUNTERED: "Countered",
    ACCEPTED: "Accepted",
    DECLINED: "Declined",
    CANCELLED: "Cancelled",
    COMPLETED: "Completed",
    EXPIRED: "Expired",
  };
  return map[s] || s;
}

// Waiting on someone is dashed, agreed is solid, finished is filled and
// anything closed is grey (see .status in styles/components.css).
export function statusClass(s) {
  if (s === "ACCEPTED") return "status";
  if (s === "PENDING" || s === "COUNTERED") return "status status--waiting";
  if (s === "COMPLETED") return "status status--done";
  return "status status--closed";
}

// A trade deadline as a date, e.g. "September 30, 2026".
export function deadlineDate(d) {
  return new Date(d).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" });
}

// Why a closed trade closed on its own (the deadlines in
// back-end/lib/tradeDeadlines.js), or null when a reader closed it.
export function closedByDeadline(ex) {
  if (ex.status === "COMPLETED" && ex.autoCompleted) return "Completed automatically after 7 days";
  if (ex.status === "EXPIRED") return "Expired after 14 days without a response";
  return null;
}
