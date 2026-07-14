/**
 * Format a number as currency (USD).
 */
export function formatCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);
}

/**
 * Format a number with thousands separators.
 */
export function formatNumber(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(val);
}

/**
 * Format a decimal value (e.g. 0.05) as percentage (e.g. 5.00%).
 */
export function formatPercent(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(val);
}

/**
 * Format a date string (e.g. YYYY-MM-DD) into a human readable form (e.g. Oct 29, 2021).
 */
export function formatDate(val: string | null | undefined): string {
  if (!val) {
    return "—";
  }
  try {
    const parts = val.split("-");
    if (parts.length === 3) {
      // Use local timezone to prevent off-by-one errors from UTC parses
      const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  } catch {
    // fallback to original string
  }
  return val;
}

/**
 * Zero-pad a CIK to exactly 10 digits.
 */
export function formatCIK(val: number | string | null | undefined): string {
  if (val === null || val === undefined) {
    return "—";
  }
  const str = val.toString().trim();
  if (!str) {
    return "—";
  }
  return str.padStart(10, "0");
}

/**
 * Format a 4-digit fiscal year end string (e.g., '0928') into readable date (e.g., 'September 28').
 */
export function formatFiscalYearEnd(val: string | null | undefined): string {
  if (!val || val.length !== 4) {
    return val || "—";
  }
  const monthStr = val.substring(0, 2);
  const dayStr = val.substring(2, 4);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const monthIdx = parseInt(monthStr, 10) - 1;
  const day = parseInt(dayStr, 10);
  if (monthIdx >= 0 && monthIdx < 12 && !isNaN(day)) {
    return `${months[monthIdx]} ${day}`;
  }
  return val;
}

