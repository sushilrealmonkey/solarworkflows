export function formatDisplayDate(value: string | null | undefined) {
  const date = parseDisplayDate(value);

  if (!date) {
    return "-";
  }

  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getFullYear()),
  ].join("/");
}

export function formatDisplayDateTime(value: string | null | undefined) {
  const date = parseDisplayDate(value);

  if (!date) {
    return "-";
  }

  return `${formatDisplayDate(value)}, ${date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function parseDisplayDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}
