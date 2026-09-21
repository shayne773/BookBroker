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
