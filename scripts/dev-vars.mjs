// Read/write the gitignored .dev.vars file (KEY=value per line) without printing values.
import fs from "node:fs";

export const DEV_VARS = ".dev.vars";

export function readDevVars() {
  if (!fs.existsSync(DEV_VARS)) return {};
  const out = {};
  for (const line of fs.readFileSync(DEV_VARS, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

export function writeDevVar(name, value) {
  const lines = fs.existsSync(DEV_VARS) ? fs.readFileSync(DEV_VARS, "utf8").split(/\r?\n/) : [];
  const i = lines.findIndex((l) => l.trim().startsWith(name + "="));
  const line = `${name}="${value}"`;
  if (i >= 0) lines[i] = line;
  else {
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(line, "");
  }
  fs.writeFileSync(DEV_VARS, lines.join("\n"));
  if (process.platform !== "win32") fs.chmodSync(DEV_VARS, 0o600); // owner-only
}
