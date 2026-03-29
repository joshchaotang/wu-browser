import { appendFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const WU_DIR = join(homedir(), '.wu-browser');
const LOG_FILE = join(WU_DIR, 'audit.log');

function ensureDir() {
  try { mkdirSync(WU_DIR, { recursive: true }); } catch {}
}

function write(line: string) {
  ensureDir();
  try { appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

export function audit(action: string, detail?: string, level?: string) {
  const ts = new Date().toISOString();
  const levelTag = level ? `[${level}]` : '';
  write(`${ts} ${action}${detail ? ' ' + detail : ''}${levelTag ? ' ' + levelTag : ''}`);
}

export function info(msg: string) {
  console.error(`[wu-browser] ${msg}`);
}

export function warn(msg: string) {
  console.error(`[wu-browser:warn] ${msg}`);
}

export function error(msg: string) {
  console.error(`[wu-browser:error] ${msg}`);
}

export function debug(msg: string) {
  if (process.env.WU_DEBUG) {
    console.error(`[wu-browser:debug] ${msg}`);
  }
}

export const WU_DIR_PATH = WU_DIR;
