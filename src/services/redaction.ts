const SENSITIVE_KEY_PATTERN = /^(access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|developer[_-]?token|authorization|password|api[_-]?key)$/i;

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /(access_token["'=:\s]+)[A-Za-z0-9._~+/=-]+/gi,
  /(refresh_token["'=:\s]+)[A-Za-z0-9._~+/=-]+/gi,
  /(client_secret["'=:\s]+)[A-Za-z0-9._~+/=-]+/gi,
  /(developer[-_]?token["'=:\s]+)[A-Za-z0-9._~+/=-]+/gi,
  // crude email matcher (private profile data we want to redact in summaries)
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
];

export const REDACTED_KEY_PATTERNS = [
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
  "developer_token",
  "authorization",
  "password",
  "api_key",
  "bearer values in text",
  "email addresses in error messages"
];

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (!value || typeof value !== "object") return typeof value === "string" ? redactSecretStrings(value) : value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSensitive(nestedValue)
    ])
  );
}

export function redactErrorMessage(message: string): string {
  return redactSecretStrings(message);
}

function redactSecretStrings(message: string): string {
  return SECRET_VALUE_PATTERNS.reduce((current, pattern) => current.replace(pattern, (match, prefix?: string) => {
    return prefix ? `${prefix}[REDACTED]` : "[REDACTED]";
  }), message);
}

/**
 * Partial-redact a Google Ads customer id for display in structured mode.
 * Input: "1234567890" or "customers/1234567890" — Output: "123-***-7890".
 */
export function redactCustomerId(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const digits = String(value).replace(/[^\d]/g, "");
  if (digits.length < 7) return value;
  return `${digits.slice(0, 3)}-***-${digits.slice(-4)}`;
}
