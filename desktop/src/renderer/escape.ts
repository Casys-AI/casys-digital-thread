const ESCAPE_REPLACEMENTS: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Encodes text for HTML body and double-quoted attribute values. */
export function escapeHtml(value: string): string {
  return String(value).replaceAll("\0", "").replaceAll(
    /[&<>"']/g,
    (char) => ESCAPE_REPLACEMENTS[char] ?? char,
  );
}
