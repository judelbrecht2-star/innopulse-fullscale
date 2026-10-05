// Preserve readable text while preventing spreadsheet programs from evaluating it.
export function csvEsc(value) {
  let text = String(value ?? "");
  if (typeof value === "string" && /^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
