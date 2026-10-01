#!/usr/bin/env node
/**
 * Upload the secrets in .dev.vars to Cloudflare (production) without printing them.
 *
 *   npm run push-secrets
 *
 * Only the names below are uploaded. Values are piped straight into
 * `wrangler secret put`, so they never appear on screen or in git.
 */
import { spawnSync } from "node:child_process";
import { readDevVars, DEV_VARS } from "./dev-vars.mjs";

const SECRETS = [
  "OS_PASSWORD",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "ADS_DEVELOPER_TOKEN",
  "SERPAPI_KEY",
];

const vars = readDevVars();
const present = SECRETS.filter((k) => vars[k]);
const absent = SECRETS.filter((k) => !vars[k]);

if (!present.length) {
  console.error(`\nNothing to upload — ${DEV_VARS} has none of: ${SECRETS.join(", ")}\n`);
  process.exit(1);
}

let failed = 0;
for (const name of present) {
  process.stdout.write(`Uploading ${name}… `);
  const result = spawnSync("npx", ["wrangler", "secret", "put", name], {
    input: vars[name],
    stdio: ["pipe", "ignore", "pipe"],
    shell: process.platform === "win32",
  });
  if (result.status === 0) console.log("done");
  else {
    failed++;
    console.log("FAILED");
    console.error(String(result.stderr || "").trim());
  }
}

if (absent.length) console.log(`\nNot set yet (skipped): ${absent.join(", ")}`);
console.log(failed ? `\n${failed} upload(s) failed. Run "npx wrangler login" and try again.\n` : "\nAll set. Changes are live immediately.\n");
process.exit(failed ? 1 : 0);
