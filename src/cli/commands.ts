import { buildConnectionStatus } from "../services/connection-status.js";
import { SERVER_VERSION } from "../constants.js";
import { parseAgentClientName } from "../services/agent-manifest.js";
import { getOnboardingFlow, getProfilePath } from "../services/profile-store.js";
import { runAuthCommand } from "./auth.js";
import { runSetupCommand } from "./setup.js";

export async function runCliCommand(args: string[]): Promise<number | undefined> {
  const [command, ...rest] = args;
  if (!command) return undefined;
  if (command === "setup") return runSetupCommand(rest);
  if (command === "doctor" || command === "status") return runDoctor(rest);
  if (command === "auth") return runAuthCommand(rest);
  if (command === "onboarding") return runOnboarding(rest);
  if (command === "version" || command === "--version" || command === "-v") {
    console.log(SERVER_VERSION);
    return 0;
  }
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }
  if (!command.startsWith("--")) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    return 1;
  }
  return undefined;
}

function runOnboarding(args: string[]): number {
  let locale: "en" | "pt-BR" = "en";
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--locale") {
      const value = args[index + 1];
      if (value === "pt-BR" || value === "en") locale = value;
      index += 1;
    } else if (args[index] === "--pt-BR" || args[index] === "--pt") {
      locale = "pt-BR";
    }
  }
  const flow = getOnboardingFlow(locale);
  console.log(JSON.stringify(flow, null, 2));
  if (process.stderr.isTTY) {
    process.stderr.write(`\n# Delx Onboarding (shared profile)\n\nLocale: ${flow.locale} · Questions: ${flow.questions.length}\nStorage path: ${getProfilePath()}\n\n`);
  }
  return 0;
}

async function runDoctor(args: string[]): Promise<number> {
  const options = parseDoctorOptions(args);
  const status = await buildConnectionStatus({ client: options.client });
  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    printDoctor(status);
  }
  return options.strict && !status.ok ? 1 : 0;
}

function parseDoctorOptions(args: string[]) {
  let client: ReturnType<typeof parseAgentClientName> | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--client") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --client.");
      client = parseAgentClientName(value);
      index += 1;
    }
  }
  return {
    json: args.includes("--json"),
    strict: args.includes("--strict"),
    client
  };
}

function printDoctor(status: Awaited<ReturnType<typeof buildConnectionStatus>>): void {
  const ok = "v";
  const fail = "x";
  const info = "-";
  const check = (passed: boolean) => (passed ? ok : fail);
  const line = (mark: string, label: string, detail?: string) => {
    const labelCol = label.padEnd(28);
    console.log(`  ${mark}  ${labelCol}${detail ? `  ${detail}` : ""}`);
  };

  console.log("Google Ads MCP · Doctor");
  console.log(`Status: ${status.ok ? `READY ${ok}` : `NEEDS SETUP ${fail}`}`);
  if (status.client) console.log(`Client: ${status.client}`);
  console.log("");
  console.log("Checks");
  line(check(status.node.supported), "Node.js >=20", status.node.supported ? undefined : `version ${status.node.version}`);
  line(check(status.missing_env.length === 0), "Env vars", status.missing_env.length ? `missing: ${status.missing_env.join(", ")}` : undefined);
  line(check(status.config.exists), "Local config", status.config.exists ? `${status.config.source} at ${status.config.path}` : "missing");
  line(check(status.automatic_auth_supported), "Automatic auth redirect", status.automatic_auth_supported ? undefined : "not configured for local callback");
  line(check(status.token.exists), "Token file", status.token.exists ? status.token.path : "missing");
  if (status.token.exists) {
    line(status.token.secure_permissions === false ? fail : ok, "Token permissions", status.token.secure_permissions === false ? "insecure (chmod 600)" : undefined);
    line(check(Boolean(status.token.has_refresh_token)), "Refresh token", status.token.has_refresh_token ? undefined : "missing");
  }
  line(info, "Privacy mode", status.privacy_mode);
  line(status.mutations_allowed ? "!" : info, "Mutations allowed", status.mutations_allowed ? "TRUE (writes enabled)" : "false (read-only)");
  line(info, "Login customer id", status.login_customer_id ? "configured" : "not set");
  line(status.cache.enabled ? ok : info, "Cache", status.cache.enabled ? `enabled at ${status.cache.path}` : "disabled");
  line(status.retry.enabled ? ok : info, "Retry middleware", status.retry.enabled ? `enabled (max ${status.retry.max_attempts})` : `disabled via ${status.retry.env_disable_flag}`);
  if (status.client_checks?.hermes) {
    const hermes = status.client_checks.hermes;
    console.log("");
    console.log("Hermes");
    line(info, "config path", hermes.config_path);
    line(check(hermes.google_ads_server_configured), "configured");
    line(check(hermes.package_pinned), "pinned package");
    line(check(hermes.skill_installed), "skill", hermes.skill_installed ? hermes.skill_path : "missing");
    line(info, "direct tool prefix", hermes.direct_tool_prefix);
  }
  console.log("");
  console.log("Next steps");
  status.next_steps.forEach((step, index) => console.log(`  ${index + 1}. ${step}`));
  if (status.client_checks?.hermes?.recommendations.length) {
    console.log("");
    console.log("Hermes recommendations");
    status.client_checks.hermes.recommendations.forEach((step, index) => console.log(`  ${index + 1}. ${step}`));
  }
}

function printHelp(): void {
  console.log(`Google Ads MCP Server

Usage:
  google-ads-mcp-server                Start MCP stdio server
  google-ads-mcp-server setup          Guided setup, local config, and MCP client config
  google-ads-mcp-server setup --allow-mutations
                                       Setup with write tools enabled (review every change!)
  google-ads-mcp-server doctor         Check setup and next steps
  google-ads-mcp-server doctor --json  Print setup status as JSON
  google-ads-mcp-server doctor --client hermes
  google-ads-mcp-server auth           Authorize Google Ads with local browser callback
  google-ads-mcp-server auth --no-open Print auth URL without opening browser
  google-ads-mcp-server onboarding     Print the shared Delx onboarding flow (11 questions)
  google-ads-mcp-server onboarding --pt-BR

Required env:
  GOOGLE_ADS_DEVELOPER_TOKEN     Approved developer token from your MCC
  GOOGLE_ADS_CLIENT_ID           Google Cloud OAuth2 client id
  GOOGLE_ADS_CLIENT_SECRET       Google Cloud OAuth2 client secret

Optional env:
  GOOGLE_ADS_LOGIN_CUSTOMER_ID   MCC customer id (no dashes) for multi-account access
  GOOGLE_ADS_ALLOW_MUTATIONS     Set 'true' to enable write tools (default false)
  GOOGLE_ADS_PRIVACY_MODE        summary | structured (default) | raw
  GOOGLE_ADS_NO_RETRY            Set 'true' to disable retry middleware
  GOOGLE_ADS_CACHE               Set 'true' or 'sqlite' to enable local cache
`);
}
