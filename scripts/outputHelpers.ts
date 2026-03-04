const useColor = Boolean(process.stdout.isTTY);

const color = (code: string) => (useColor ? code : "");

export const c = {
  reset: color("\x1b[0m"),
  bold: color("\x1b[1m"),
  green: color("\x1b[32m"),
  red: color("\x1b[31m"),
  yellow: color("\x1b[33m"),
  cyan: color("\x1b[36m"),
  white: color("\x1b[37m"),
  gray: color("\x1b[90m"),
};

export const HR = `${c.gray}${"─".repeat(72)}${c.reset}`;

export function label(key: string, value: string, extra = "") {
  const pad = "  " + key.padEnd(14);
  return `${c.gray}${pad}${c.reset}${value}${extra ? c.gray + "  " + extra + c.reset : ""}`;
}

export function ok(msg: string) {
  return `${c.green}✅${c.reset}  ${msg}`;
}

export function locked(msg: string) {
  return `${c.yellow}🔒${c.reset}  ${msg}`;
}

export function errLine(msg: string) {
  return `${c.red}✗${c.reset}  ${msg}`;
}
