#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { runCliCommand } from "./cli/commands.js";
import { registerGoogleAdsTools } from "./tools/google-ads-tools.js";

function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerGoogleAdsTools(server);
  return server;
}

async function runStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const args = new Set(process.argv.slice(2));
let cliResult: number | undefined;

try {
  cliResult = await runCliCommand(process.argv.slice(2));
} catch (error) {
  console.error(`Error: ${(error as Error).message}`);
  process.exitCode = 1;
}

if (cliResult !== undefined) {
  process.exitCode = cliResult;
} else if (process.exitCode === undefined) {
  void args;
  await runStdio();
}
