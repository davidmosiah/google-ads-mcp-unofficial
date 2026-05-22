import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { getConfig } from "../services/config.js";
import { GoogleAdsClient } from "../services/google-ads-client.js";

export interface LocalRedirectPlan {
  host: string;
  port: number;
  path: string;
}

export function parseLocalRedirectUri(value: string): LocalRedirectPlan {
  const url = new URL(value);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (url.protocol !== "http:" || !localHosts.has(url.hostname) || !url.port) {
    throw new Error("Automatic auth requires a local redirect URI such as http://127.0.0.1:3000/callback.");
  }
  return {
    host: url.hostname === "localhost" ? "127.0.0.1" : url.hostname.replace(/^\[(.*)\]$/, "$1"),
    port: Number(url.port),
    path: url.pathname || "/callback"
  };
}

export async function runAuthCommand(args: string[]): Promise<number> {
  const noOpen = args.includes("--no-open");
  const json = args.includes("--json");
  const config = getConfig();
  const redirect = parseLocalRedirectUri(config.redirectUri);
  const state = randomBytes(4).toString("hex");
  const client = new GoogleAdsClient(config);
  const authUrl = client.authUrl(state);
  const timeoutMs = Number(process.env.GOOGLE_ADS_AUTH_TIMEOUT_MS ?? 300_000);

  const result = await waitForOAuthCode(redirect, state, timeoutMs, async (url) => {
    if (!json) {
      console.log("Google Ads MCP · Authorization");
      console.log("");
      if (noOpen) {
        console.log("Open this URL manually:");
        console.log(`  ${url}`);
      } else {
        console.log("Opening Google authorization in your browser...");
      }
      console.log("");
      console.log("Steps");
      console.log("  1. Approve access in the browser tab.");
      console.log("  2. Google will redirect to the local callback.");
      console.log("  3. Tokens are saved locally; this command never prints them.");
      console.log("");
      console.log("Waiting for callback...");
    }
    if (!noOpen) openBrowser(url);
  }, authUrl);

  const exchange = await client.exchangeCode(result.code);
  const output = {
    ok: true,
    token_path: exchange.token_path,
    expires_at: exchange.expires_at,
    scope: exchange.scope,
    has_refresh_token: exchange.has_refresh_token,
    next_step: "Run `google-ads-mcp-server doctor`, then add the MCP server to your agent."
  };
  if (json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log("");
    console.log("v Google Ads connected");
    console.log("");
    console.log(`  Token file:    ${output.token_path}`);
    if (output.scope) console.log(`  Scope:         ${output.scope}`);
    if (output.expires_at) console.log(`  Expires at:    ${output.expires_at}`);
    console.log(`  Refresh token: ${output.has_refresh_token ? "yes" : "MISSING (re-revoke + re-auth)"}`);
    console.log("");
    console.log(`-> Next: ${output.next_step}`);
  }
  return 0;
}

function waitForOAuthCode(
  redirect: LocalRedirectPlan,
  expectedState: string,
  timeoutMs: number,
  onReady: (authUrl: string) => Promise<void> | void,
  authUrl: string
): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for Google Ads OAuth callback."));
    }, timeoutMs);

    const server = createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url ?? "/", `http://${redirect.host}:${redirect.port}`);
        if (requestUrl.pathname !== redirect.path) {
          res.writeHead(404).end("Not found");
          return;
        }
        const error = requestUrl.searchParams.get("error");
        const code = requestUrl.searchParams.get("code");
        const state = requestUrl.searchParams.get("state");
        if (error) throw new Error(`Google Ads authorization failed: ${error}`);
        if (!code) throw new Error("Google Ads callback did not include a code.");
        if (state !== expectedState) throw new Error("Google Ads callback state mismatch.");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(successHtml());
        clearTimeout(timeout);
        server.close();
        resolve({ code });
      } catch (error) {
        clearTimeout(timeout);
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end((error as Error).message);
        server.close();
        reject(error);
      }
    });

    server.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.listen(redirect.port, redirect.host, async () => {
      try {
        await onReady(authUrl);
      } catch (error) {
        clearTimeout(timeout);
        server.close();
        reject(error);
      }
    });
  });
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function successHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Google Ads connected</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 64px 24px; line-height: 1.5; color: #111; }
    .check { width: 56px; height: 56px; border-radius: 999px; background: #4285F4; color: #fff; display: grid; place-items: center; font-size: 28px; font-weight: 600; margin-bottom: 24px; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    .lede { color: #6b7280; margin: 0 0 32px; }
    code { font-family: ui-monospace, "SF Mono", Menlo, monospace; background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="check">&check;</div>
  <h1>Google Ads connected</h1>
  <p class="lede">Tokens saved locally with user-only permissions. Your MCP client never sees them.</p>
  <ol>
    <li>Switch back to your terminal.</li>
    <li>Run <code>google-ads-mcp-server doctor</code> to verify setup.</li>
    <li>Add the MCP server to your AI client.</li>
  </ol>
</body>
</html>`;
}
