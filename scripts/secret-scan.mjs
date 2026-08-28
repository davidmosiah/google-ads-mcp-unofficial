import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(new URL(".", import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const files = pkg.files;
for (const banned of ["fixtures", ".google-ads-mcp", ".env", "tokens.json", "src"]) {
  assert.equal(files.includes(banned), false, `package files must not include ${banned}`);
}
assert.ok(files.includes("dist"));
assert.ok(files.includes("README.md"));

const assignment = /[A-Z0-9_]*ALLOW_MUTATIONS\s*=\s*true/;
const docs = [
  "examples/claude-desktop.json",
  "examples/codex.toml",
  "examples/cursor.json",
  "examples/hermes.md",
  "examples/openclaw.md",
  "README.md",
  "llms.txt",
  "SECURITY.md",
  "AGENTS.md"
];
for (const rel of docs) {
  const path = join(root, rel);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, "utf8");
  assert.doesNotMatch(text, assignment, `${rel} must not contain a copyable *_ALLOW_MUTATIONS=true assignment`);
}

console.log(JSON.stringify({ ok: true, suite: "secret-scan", files }, null, 2));
