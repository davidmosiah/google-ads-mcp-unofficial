import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface as createCallbackInterface } from "node:readline";
import { createInterface as createPromptInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { NPM_PACKAGE_NAME, PINNED_NPM_PACKAGE } from "../constants.js";
import { hermesConfigSnippet, hermesSkillMarkdown, parseAgentClientName, type AgentClientName } from "../services/agent-manifest.js";
import { writeLocalConfig, type LocalGoogleAdsConfig } from "../services/local-config.js";
import { runAuthCommand } from "./auth.js";

interface SetupOptions {
  client: AgentClientName;
  developerToken: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  loginCustomerId?: string;
  privacyMode: "summary" | "structured" | "raw";
  allowMutations: boolean;
  cache?: string;
  noAuth: boolean;
  json: boolean;
  homeDir: string;
}

interface ClientConfigResult {
  path: string;
  hermes_skill_path?: string;
  hermes_config_backup_path?: string;
  warnings?: string[];
}

export async function runSetupCommand(args: string[]): Promise<number> {
  const options = await parseSetupOptions(args);
  const config: LocalGoogleAdsConfig = {
    GOOGLE_ADS_DEVELOPER_TOKEN: options.developerToken,
    GOOGLE_ADS_CLIENT_ID: options.clientId,
    GOOGLE_ADS_CLIENT_SECRET: options.clientSecret,
    GOOGLE_ADS_REDIRECT_URI: options.redirectUri,
    GOOGLE_ADS_PRIVACY_MODE: options.privacyMode
  };
  if (options.loginCustomerId) config.GOOGLE_ADS_LOGIN_CUSTOMER_ID = options.loginCustomerId;
  if (options.allowMutations) config.GOOGLE_ADS_ALLOW_MUTATIONS = "true";
  if (options.cache) config.GOOGLE_ADS_CACHE = options.cache;

  const configPath = writeLocalConfig(config, options.homeDir);
  const clientConfig = writeClientConfig(options.client, options.homeDir);
  const setupOutput = {
    ok: true,
    config_path: configPath,
    client: options.client,
    client_config_path: clientConfig.path,
    hermes_skill_path: clientConfig.hermes_skill_path,
    hermes_config_backup_path: clientConfig.hermes_config_backup_path,
    warnings: clientConfig.warnings,
    allow_mutations: options.allowMutations,
    auth_started: !options.noAuth,
    next_step: setupNextStep(options.client, options.noAuth)
  };

  if (options.json) console.log(JSON.stringify(setupOutput, null, 2));
  else {
    console.log("Google Ads MCP · Setup");
    console.log("");
    console.log(`  v  Local config       ${configPath}`);
    console.log(`  v  MCP client config  ${clientConfig.path}`);
    if (clientConfig.hermes_skill_path) console.log(`  v  Hermes skill       ${clientConfig.hermes_skill_path}`);
    if (options.allowMutations) console.log(`  !  Mutations enabled  GOOGLE_ADS_ALLOW_MUTATIONS=true — review every change`);
    console.log("");
    console.log("Secrets were saved only in the local config file (chmod 600).");
    console.log(`-> Next: ${setupOutput.next_step}`);
  }

  if (!options.noAuth) {
    return runAuthCommand(options.json ? ["--json"] : []);
  }
  return 0;
}

async function parseSetupOptions(args: string[]): Promise<SetupOptions> {
  const flags = parseFlags(args);
  const json = flags.has("json");
  const homeDir = flags.get("home-dir") ?? homedir();
  const interactive = !json && !flags.has("non-interactive") && process.stdin.isTTY;

  const answers = interactive ? await promptForMissing(flags) : flags;
  const client = parseAgentClientName(answers.get("client") ?? "generic");
  const developerToken = required(answers, "developer-token", "Google Ads Developer Token");
  const clientId = required(answers, "client-id", "Google OAuth Client ID");
  const clientSecret = required(answers, "client-secret", "Google OAuth Client Secret");
  const redirectUri = answers.get("redirect-uri") ?? "http://127.0.0.1:3000/callback";
  const loginCustomerId = answers.get("login-customer-id");
  const privacyMode = parsePrivacyMode(answers.get("privacy-mode") ?? "structured");
  const allowMutations = flags.has("allow-mutations") || answers.get("allow-mutations") === "true";
  const cache = answers.get("cache");

  return {
    client,
    developerToken,
    clientId,
    clientSecret,
    redirectUri,
    loginCustomerId: loginCustomerId?.replace(/[^\d]/g, "") || undefined,
    privacyMode,
    allowMutations,
    cache,
    noAuth: flags.has("no-auth"),
    json,
    homeDir
  };
}

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(name, "true");
    } else {
      flags.set(name, next);
      index += 1;
    }
  }
  return flags;
}

async function promptForMissing(flags: Map<string, string>): Promise<Map<string, string>> {
  const merged = new Map(flags);
  const firstPrompt = createPromptInterface({ input, output });
  try {
    if (!merged.has("client")) merged.set("client", (await firstPrompt.question("MCP client (generic/claude/cursor/windsurf/hermes/openclaw) [generic]: ")).trim() || "generic");
    if (!merged.has("developer-token")) merged.set("developer-token", (await firstPrompt.question("Google Ads Developer Token: ")).trim());
    if (!merged.has("client-id")) merged.set("client-id", (await firstPrompt.question("Google OAuth Client ID: ")).trim());
  } finally {
    firstPrompt.close();
  }
  if (!merged.has("client-secret")) merged.set("client-secret", await promptHidden("Google OAuth Client Secret: "));

  const secondPrompt = createPromptInterface({ input, output });
  try {
    if (!merged.has("login-customer-id")) merged.set("login-customer-id", (await secondPrompt.question("Login Customer ID (MCC) [skip if not multi-account]: ")).trim());
    if (!merged.has("redirect-uri")) merged.set("redirect-uri", (await secondPrompt.question("Google Redirect URI [http://127.0.0.1:3000/callback]: ")).trim() || "http://127.0.0.1:3000/callback");
    if (!merged.has("privacy-mode")) merged.set("privacy-mode", (await secondPrompt.question("Privacy mode (summary/structured/raw) [structured]: ")).trim() || "structured");
    if (!merged.has("allow-mutations")) {
      const answer = (await secondPrompt.question("Enable write tools (pause/bid/budget)? (y/N): ")).trim().toLowerCase();
      if (answer === "y" || answer === "yes") merged.set("allow-mutations", "true");
    }
  } finally {
    secondPrompt.close();
  }
  return merged;
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createCallbackInterface({ input, output, terminal: true }) as ReturnType<typeof createCallbackInterface> & {
      stdoutMuted?: boolean;
      _writeToOutput?: (text: string) => void;
    };
    const originalWrite = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = (text: string) => {
      if (rl.stdoutMuted && text !== "\n" && text !== "\r\n") output.write("*");
      else if (originalWrite) originalWrite(text);
      else output.write(text);
    };
    rl.stdoutMuted = true;
    rl.question(question, (answer) => {
      rl.stdoutMuted = false;
      rl.close();
      output.write("\n");
      resolve(answer.trim());
    });
  });
}

function required(flags: Map<string, string>, key: string, label: string): string {
  const value = flags.get(key);
  if (!value || value === "true") throw new Error(`${label} is required. Pass --${key} or run setup interactively.`);
  return value;
}

function parsePrivacyMode(value: string): "summary" | "structured" | "raw" {
  if (value === "summary" || value === "structured" || value === "raw") return value;
  throw new Error("Privacy mode must be summary, structured or raw.");
}

function writeClientConfig(client: AgentClientName, homeDir: string): ClientConfigResult {
  if (client === "claude") return { path: mergeClaudeConfig(homeDir) };
  if (client === "hermes") return writeHermesClientConfig(homeDir);
  const path = join(homeDir, ".google-ads-mcp", "mcp-configs", `${client}.json`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(mcpConfigSnippet(), null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return { path };
}

function mergeClaudeConfig(homeDir: string): string {
  const path = process.platform === "darwin"
    ? join(homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json")
    : join(homeDir, ".google-ads-mcp", "mcp-configs", "claude-desktop.json");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    existing = {};
  }
  const mcpServers = typeof existing.mcpServers === "object" && existing.mcpServers ? existing.mcpServers as Record<string, unknown> : {};
  const next = {
    ...existing,
    mcpServers: {
      ...mcpServers,
      "google-ads": mcpConfigSnippet().mcpServers["google-ads"]
    }
  };
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

function mcpConfigSnippet() {
  return {
    mcpServers: {
      "google-ads": {
        command: "npx",
        args: ["-y", NPM_PACKAGE_NAME]
      }
    }
  };
}

function writeHermesClientConfig(homeDir: string): ClientConfigResult {
  const configPath = join(homeDir, ".hermes", "config.yaml");
  const skillPath = join(homeDir, ".hermes", "skills", "google-ads-mcp", "SKILL.md");
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  mkdirSync(dirname(skillPath), { recursive: true, mode: 0o700 });

  const backupPath = mergeHermesConfig(configPath);
  writeFileSync(skillPath, `${hermesSkillMarkdown()}\n`, { mode: 0o600 });
  chmodSync(skillPath, 0o600);

  return {
    path: configPath,
    hermes_skill_path: skillPath,
    hermes_config_backup_path: backupPath,
    warnings: [
      "After editing Hermes MCP config, use `/reload-mcp` or `hermes mcp test google-ads`; do not restart the Hermes gateway for normal data access.",
      `Hermes config pins ${PINNED_NPM_PACKAGE} to avoid stale npx cache behavior.`
    ]
  };
}

function mergeHermesConfig(configPath: string): string | undefined {
  const snippet = hermesConfigSnippet();
  if (!existsSync(configPath)) {
    writeFileSync(configPath, `${snippet}\n`, { mode: 0o600 });
    chmodSync(configPath, 0o600);
    return undefined;
  }

  const existing = readFileSync(configPath, "utf8");
  if (/google-ads-mcp-unofficial|google-ads-mcp-server|google-ads-mcp/.test(existing) && /^\s*google[-_]ads\s*:/m.test(existing)) {
    if (existing.includes(PINNED_NPM_PACKAGE)) return undefined;
    const backupPath = backupConfig(configPath);
    const updated = existing.replace(/google-ads-mcp-unofficial(?:@\d+\.\d+\.\d+)?/g, PINNED_NPM_PACKAGE);
    writeFileSync(configPath, updated, { mode: 0o600 });
    chmodSync(configPath, 0o600);
    return backupPath;
  }

  const backupPath = backupConfig(configPath);
  const next = existing.trimEnd().length ? addHermesGoogleAdsBlock(existing) : snippet;
  writeFileSync(configPath, next, { mode: 0o600 });
  chmodSync(configPath, 0o600);
  return backupPath;
}

function addHermesGoogleAdsBlock(existing: string): string {
  const serverBlock = [
    "  google-ads:",
    "    command: npx",
    "    args:",
    "      - -y",
    `      - ${PINNED_NPM_PACKAGE}`
  ].join("\n");
  const trimmed = existing.trimEnd();
  if (/^mcp_servers:\s*$/m.test(trimmed)) {
    return `${trimmed.replace(/^mcp_servers:\s*$/m, `mcp_servers:\n${serverBlock}`)}\n`;
  }
  return `${trimmed}\n\n# Added by ${NPM_PACKAGE_NAME} setup.\nmcp_servers:\n${serverBlock}\n`;
}

function backupConfig(path: string): string {
  const backupPath = `${path}.bak-google-ads-mcp-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z")}`;
  renameSync(path, backupPath);
  chmodSync(backupPath, 0o600);
  writeFileSync(path, readFileSync(backupPath, "utf8"), { mode: 0o600 });
  chmodSync(path, 0o600);
  return backupPath;
}

function setupNextStep(client: AgentClientName, noAuth: boolean): string {
  const auth = noAuth ? "Run `google-ads-mcp-server auth`, then " : "";
  if (client === "hermes") {
    return `${auth}run \`google-ads-mcp-server doctor --client hermes\`, then use \`/reload-mcp\` or \`hermes mcp test google-ads\`.`;
  }
  return `${auth}run \`google-ads-mcp-server doctor\`.`;
}
