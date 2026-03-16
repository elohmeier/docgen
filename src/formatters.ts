// Port of docgen/app/formatters.py to TypeScript

const GERMAN_MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

const PASSTHROUGH_VALUES = new Set(["manuell", "manual", "-", "n/a", "N/A"]);

function parseISODate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

export function fmt_dec(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null || (typeof value === "number" && isNaN(value))) return "";
  const num = Number(value);
  if (isNaN(num)) return String(value);
  // German decimal: 1.234,56
  const parts = num.toFixed(2).split(".");
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return intPart + "," + parts[1];
}

export function fmt_date(value: unknown): string {
  if (value == null || (typeof value === "number" && isNaN(value))) return "";
  if (value instanceof Date) {
    const d = value.getDate().toString().padStart(2, "0");
    const m = (value.getMonth() + 1).toString().padStart(2, "0");
    return `${d}.${m}.${value.getFullYear()}`;
  }
  if (typeof value === "string") {
    if (PASSTHROUGH_VALUES.has(value)) return value;
    const date = parseISODate(value);
    if (!date) return value;
    return fmt_date(date);
  }
  return String(value);
}

export function fmt_month(value: unknown): string {
  if (value == null || (typeof value === "number" && isNaN(value))) return "";
  if (value instanceof Date) {
    return `${GERMAN_MONTHS[value.getMonth()]} ${value.getFullYear()}`;
  }
  if (typeof value === "string") {
    if (PASSTHROUGH_VALUES.has(value)) return value;
    const date = parseISODate(value);
    if (!date) return value;
    return fmt_month(date);
  }
  return String(value);
}

export function fmt_iban(value: unknown): string {
  if (typeof value !== "string") return String(value);
  const clean = value.replace(/\s/g, "");
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/i.test(clean)) return value;
  return clean.match(/.{1,4}/g)!.join(" ");
}
