import type { ResponseFormat, ToolResponse } from "../types.js";
import { MICROS_PER_UNIT } from "../constants.js";
import { redactErrorMessage, redactSensitive } from "./redaction.js";

export function makeResponse<T>(data: T, format: ResponseFormat, markdown: string): ToolResponse<T> {
  const safeData = redactSensitive(data) as T;
  const safeMarkdown = redactErrorMessage(markdown);
  return {
    content: [{ type: "text", text: format === "json" ? JSON.stringify(safeData, null, 2) : safeMarkdown }],
    structuredContent: safeData
  };
}

export function makeError(message: string): ToolResponse<{ error: string }> {
  const safeMessage = redactErrorMessage(message);
  return {
    isError: true,
    content: [{ type: "text", text: `Error: ${safeMessage}` }],
    structuredContent: { error: safeMessage }
  };
}

export function bulletList(title: string, fields: Record<string, unknown>): string {
  const lines = [`# ${title}`, ""];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    lines.push(`- **${key}**: ${String(value)}`);
  }
  return lines.join("\n");
}

export function formatCollection(title: string, records: unknown[], meta: Record<string, unknown>): string {
  const lines = [`# ${title}`, ""];
  for (const [key, value] of Object.entries(meta)) {
    if (key === "records" || value === undefined || value === null) continue;
    lines.push(`- **${key}**: ${formatScalar(value)}`);
  }
  lines.push("");
  const preview = records.slice(0, 8);
  for (const [index, record] of preview.entries()) {
    if (record && typeof record === "object") {
      const object = record as Record<string, unknown>;
      const id = object.id ?? object.resource_name ?? `item-${index + 1}`;
      lines.push(`## ${String(id)}`);
      for (const [k, v] of Object.entries(object).slice(0, 6)) {
        if (k === "id" || k === "resource_name") continue;
        lines.push(`- **${k}**: ${formatScalar(v)}`);
      }
      lines.push("");
    } else {
      lines.push(`- ${JSON.stringify(record)}`);
    }
  }
  if (records.length > preview.length) {
    lines.push(`... ${records.length - preview.length} more records omitted from markdown preview.`);
  }
  return lines.join("\n");
}

function formatScalar(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => formatScalar(item)).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Convert integer micros (Google Ads units) to a decimal currency string. */
export function microsToUnit(micros: number | string | undefined | null): number | undefined {
  if (micros === undefined || micros === null) return undefined;
  const n = typeof micros === "string" ? Number(micros) : micros;
  if (!Number.isFinite(n)) return undefined;
  return n / MICROS_PER_UNIT;
}

/** Convert a decimal unit value to integer micros (for write tools). */
export function unitToMicros(unit: number): number {
  return Math.round(unit * MICROS_PER_UNIT);
}
