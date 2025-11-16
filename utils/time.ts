const DAY_MS = 1000 * 60 * 60 * 24;

const toDate = (value?: string | number | Date): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatRelativeTime = (value?: string | number | Date): string | undefined => {
  const date = toDate(value);
  if (!date) return undefined;
  const diffMs = Math.max(0, Date.now() - date.getTime());
  const days = Math.floor(diffMs / DAY_MS);
  if (days >= 365) {
    const years = Math.max(1, Math.floor(days / 365));
    return `${years} year${years === 1 ? "" : "s"} ago`;
  }
  if (days >= 30) {
    const months = Math.max(1, Math.floor(days / 30));
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }
  return `${days} day${days === 1 ? "" : "s"} ago`;
};
