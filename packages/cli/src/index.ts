import { runSetup } from "./commands/setup.js";
import { runStatus } from "./commands/status.js";
import { c } from "./output.js";

const HELP = `
${c.bold}agentstorage${c.reset} — AgentStorage CLI

${c.gray}Usage:${c.reset}
  agentstorage setup  --base <URL> [--name <name>] [--force]
  agentstorage status

${c.gray}Commands:${c.reset}
  setup     Create a workspace, write ~/.agentstorage/config.json, verify connection
  status    Read local config and check current workspace state

${c.gray}Options (setup):${c.reset}
  --base    Base URL of your AgentStorage deployment (required)
            Also reads: AGENTSTORAGE_URL env var
  --name    Workspace name (default: "default")
  --force   Overwrite existing config

${c.gray}Examples:${c.reset}
  npx agentstorage setup --base https://your-deploy.convex.site --name my-project
  npx agentstorage status
`;

async function main() {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case "setup":
      await runSetup(rest);
      break;
    case "status":
      await runStatus();
      break;
    case "--help":
    case "-h":
    case undefined:
      console.log(HELP);
      break;
    default:
      console.error(`${c.red}Unknown command: ${command}${c.reset}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(`${c.red}✗${c.reset}  ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
