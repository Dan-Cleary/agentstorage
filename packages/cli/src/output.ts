// ANSI color codes — disabled automatically when stdout is not a TTY
const isTTY = process.stdout.isTTY;

const raw = (code: string) => (isTTY ? code : "");

export const c = {
  reset:  raw("\x1b[0m"),
  bold:   raw("\x1b[1m"),
  green:  raw("\x1b[32m"),
  red:    raw("\x1b[31m"),
  yellow: raw("\x1b[33m"),
  cyan:   raw("\x1b[36m"),
  white:  raw("\x1b[37m"),
  gray:   raw("\x1b[90m"),
};

export const HR = c.gray + "─".repeat(72) + c.reset;

export function label(key: string, value: string, note = "") {
  const pad = "  " + key.padEnd(14);
  return `${c.gray}${pad}${c.reset}${value}${note ? `${c.gray}  ${note}${c.reset}` : ""}`;
}

export const ok     = (msg: string) => `${c.green}✅${c.reset}  ${msg}`;
export const locked = (msg: string) => `${c.yellow}🔒${c.reset}  ${msg}`;
export const fail   = (msg: string) => `${c.red}❌${c.reset}  ${msg}`;
