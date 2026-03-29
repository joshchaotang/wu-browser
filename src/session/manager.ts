/**
 * session/manager.ts — 加密 Session 持久化
 *
 * 保存/恢復 cookies + localStorage，支援 AES-256-GCM 加密。
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getClient } from '../browser/connection.js';

const SESSIONS_DIR = join(homedir(), '.wu-browser', 'sessions');

interface SessionData {
  name: string;
  url: string;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite?: string;
  }>;
  localStorage: Record<string, string>;
  timestamp: string;
}

function getEncryptionKey(): Buffer | null {
  const keyHex = process.env.WU_BROWSER_ENCRYPTION_KEY;
  if (!keyHex) return null;
  // Accept hex (64 chars) or raw string (32 chars)
  if (keyHex.length === 64 && /^[0-9a-f]+$/i.test(keyHex)) {
    return Buffer.from(keyHex, 'hex');
  }
  // Use first 32 bytes of string as key
  const buf = Buffer.alloc(32);
  buf.write(keyHex, 'utf-8');
  return buf;
}

function encrypt(data: string): string {
  const key = getEncryptionKey();
  if (!key) return data; // plaintext fallback

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: iv:tag:ciphertext (all hex)
  return `ENC:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(data: string): string {
  if (!data.startsWith('ENC:')) return data; // plaintext

  const key = getEncryptionKey();
  if (!key) throw new Error('Session is encrypted but WU_BROWSER_ENCRYPTION_KEY is not set');

  const parts = data.split(':');
  if (parts.length !== 4) throw new Error('Invalid encrypted session format');

  const iv = Buffer.from(parts[1], 'hex');
  const tag = Buffer.from(parts[2], 'hex');
  const encrypted = Buffer.from(parts[3], 'hex');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf-8');
}

function sessionPath(name: string): string {
  return join(SESSIONS_DIR, `${name}.json`);
}

/** Save current browser session (cookies + localStorage) */
export async function saveSession(name: string): Promise<{ cookieCount: number; encrypted: boolean }> {
  const client = await getClient();
  const { Network, Runtime, Page } = client;

  // Get current URL
  let url = 'about:blank';
  try {
    const frame = await Page.getFrameTree();
    url = frame.frameTree.frame.url;
  } catch {}

  // Get cookies
  const { cookies } = await Network.getCookies({});

  // Get localStorage
  let localStorage: Record<string, string> = {};
  try {
    const result = await Runtime.evaluate({
      expression: `JSON.stringify(Object.fromEntries(Object.entries(localStorage)))`,
      returnByValue: true,
    });
    if (result.result.value) {
      localStorage = JSON.parse(result.result.value as string);
    }
  } catch {
    // localStorage may not be accessible
  }

  const sessionData: SessionData = {
    name,
    url,
    cookies: cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    })),
    localStorage,
    timestamp: new Date().toISOString(),
  };

  mkdirSync(SESSIONS_DIR, { recursive: true });
  const json = JSON.stringify(sessionData, null, 2);
  const encrypted = !!getEncryptionKey();
  const content = encrypt(json);
  writeFileSync(sessionPath(name), content, 'utf-8');

  if (!encrypted) {
    process.stderr.write('[wu-browser] Warning: session saved in plaintext. Set WU_BROWSER_ENCRYPTION_KEY for encryption.\n');
  }

  return { cookieCount: cookies.length, encrypted };
}

/** Restore a saved session (cookies + localStorage) */
export async function restoreSession(name: string): Promise<{ cookieCount: number; url: string }> {
  const raw = readFileSync(sessionPath(name), 'utf-8');
  const json = decrypt(raw);
  const data: SessionData = JSON.parse(json);

  const client = await getClient();
  const { Network, Runtime, Page } = client;

  // Navigate to the session's URL first (cookies need the right domain)
  if (data.url && data.url !== 'about:blank') {
    await Page.navigate({ url: data.url });
    await new Promise(r => setTimeout(r, 1000));
  }

  // Set cookies
  for (const cookie of data.cookies) {
    try {
      await Network.setCookie({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite as any,
      });
    } catch {
      // Some cookies may fail (different domain)
    }
  }

  // Restore localStorage
  if (Object.keys(data.localStorage).length > 0) {
    try {
      await Runtime.evaluate({
        expression: `(function() {
          var data = ${JSON.stringify(data.localStorage)};
          for (var k in data) localStorage.setItem(k, data[k]);
        })()`,
      });
    } catch {
      // localStorage may not be accessible
    }
  }

  // Reload to apply cookies
  await Page.reload({});
  await new Promise(r => setTimeout(r, 1000));

  return { cookieCount: data.cookies.length, url: data.url };
}

/** List all saved sessions */
export function listSessions(): Array<{ name: string; timestamp: string; encrypted: boolean }> {
  try {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
    return files.map(f => {
      const name = f.replace('.json', '');
      try {
        const raw = readFileSync(join(SESSIONS_DIR, f), 'utf-8');
        const encrypted = raw.startsWith('ENC:');
        let timestamp = 'unknown';
        if (!encrypted) {
          const data = JSON.parse(raw);
          timestamp = data.timestamp ?? 'unknown';
        }
        return { name, timestamp, encrypted };
      } catch {
        return { name, timestamp: 'unknown', encrypted: false };
      }
    });
  } catch {
    return [];
  }
}

/** Delete a saved session */
export function deleteSession(name: string): boolean {
  try {
    unlinkSync(sessionPath(name));
    return true;
  } catch {
    return false;
  }
}
