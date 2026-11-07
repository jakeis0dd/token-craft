// Only expose diagnostic fields. Never stringify an entire SDK rejection: it
// can contain asset URLs or authentication data alongside the actual error.
const MAX_DEPTH = 4;
const MAX_ARRAY_LENGTH = 3;
const MAX_NODES = 24;
const MAX_DETAILS = 12;
const MAX_OUTPUT_LENGTH = 600;
const PARAMETERS = new Set(["multiple", "defaultSearch", "typeHint"]);

function safeDetail(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return;
  if (typeof value === "number" && !Number.isFinite(value)) return;
  if (typeof value === "string" && value.length > 240) return "[Sensitive details omitted]";
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!text || text === "[object Object]") return;
  // Omit the entire field when it might contain private data. This also covers
  // relative/signed URLs, credential assignments and unlabelled opaque tokens.
  const opaqueValue = (text.match(/[A-Za-z\d+/_=-]{24,}/g) || [])
    .some(word => !/^(?:OBR_|ERR_)[A-Z\d_]+$/.test(word));
  if (text.length > 240 || opaqueValue || /[a-z][a-z\d+.-]*:\/\/|\/\/|\b(?:blob|data|file):|[?&#]|%[\da-f]{2}|\b(?:authorization|authentication|bearer|cookie|credentials?|password|passwd|secret|token|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|signature)\b|[\w.-]+\s*[=:]\s*\S|[A-Za-z\d_-]+\.[A-Za-z\d_-]+\.[A-Za-z\d_-]+/i.test(text)) {
    return "[Sensitive details omitted]";
  }
  return text;
}

function readField(value: object, field: string): unknown {
  try {
    return (value as Record<string, unknown>)[field];
  } catch {
    // A throwing property must not prevent the user from seeing feedback.
    return undefined;
  }
}

export function formatImportError(error: unknown): string {
  const details = new Set<string>();
  const seen = new WeakSet<object>();
  let nodes = 0;
  function add(value: string | undefined) {
    if (value && details.size < MAX_DETAILS) details.add(value);
  }
  function visit(value: unknown, depth: number) {
    if (depth > MAX_DEPTH || nodes++ >= MAX_NODES || details.size >= MAX_DETAILS) return;
    if (value === null || typeof value !== "object") {
      add(safeDetail(value));
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let index = 0; index < Math.min(value.length, MAX_ARRAY_LENGTH); index++) {
        visit(readField(value, String(index)), depth + 1);
      }
      return;
    }
    for (const field of ["name", "code", "message"] as const) {
      const detail = safeDetail(readField(value, field));
      if (detail) add(`${field}: ${detail}`);
    }
    // Validation paths may contain private identifiers. Only echo exact known
    // argument names, never arbitrary path segments or their rejected values.
    const path = readField(value, "path");
    if (typeof path === "string" && PARAMETERS.has(path)) add(`parameter: ${path}`);
    else if (Array.isArray(path)) {
      for (let index = 0; index < Math.min(path.length, MAX_ARRAY_LENGTH); index++) {
        const parameter = readField(path, String(index));
        if (typeof parameter === "string" && PARAMETERS.has(parameter)) add(`parameter: ${parameter}`);
      }
    }
    for (const field of ["error", "errors", "issues", "cause"] as const) {
      visit(readField(value, field), depth + 1);
    }
  }
  let kind: string = error === null ? "null" : typeof error;
  try {
    if (Array.isArray(error)) kind = "array";
    visit(error, 0);
  } catch {
    // Also tolerate unusual values such as revoked proxies without dumping them.
  }
  const result = [...details].join("; ") || `No readable error details were provided (${kind} rejection).`;
  return result.length > MAX_OUTPUT_LENGTH ? result.slice(0, MAX_OUTPUT_LENGTH - 1) + "…" : result;
}
