import CDP from 'chrome-remote-interface';
import { info, warn, error, debug } from '../utils/logger.js';
import { launchChrome } from './launcher.js';

export type CDPClient = CDP.Client;

interface ConnectionOptions {
  port?: number;
  host?: string;
  maxRetries?: number;
}

let _client: CDPClient | null = null;
let _port = 9222;
let _host = 'localhost';

export async function connect(opts: ConnectionOptions = {}): Promise<CDPClient> {
  _port = opts.port ?? 9222;
  _host = opts.host ?? 'localhost';
  const maxRetries = opts.maxRetries ?? 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      debug(`Connecting to Chrome on ${_host}:${_port} (attempt ${attempt})`);

      // 如果沒有可用 page target，先開一個新 tab
      let targetId: string | undefined;
      try {
        const targets = await CDP.List({ host: _host, port: _port });
        const pageTarget = targets.find((t: { type: string }) => t.type === 'page');
        if (!pageTarget) {
          debug('No page targets, creating new tab');
          const newTarget = await CDP.New({ host: _host, port: _port });
          targetId = newTarget.id;
        } else {
          targetId = pageTarget.id;
        }
      } catch {
        // 列表失敗 → 嘗試直接連
      }

      const connectOpts = targetId
        ? { host: _host, port: _port, target: targetId }
        : { host: _host, port: _port };

      const client = await CDP(connectOpts);
      _client = client;

      // 監聽斷線事件，自動重連
      client.on('disconnect', () => {
        warn('CDP disconnected, will reconnect on next call');
        _client = null;
      });

      info(`Connected to Chrome on port ${_port}`);
      return client;
    } catch (err) {
      if (attempt < maxRetries) {
        debug(`Connection failed, trying to launch Chrome...`);
        try {
          await launchChrome(_port);
          await sleep(2000);
        } catch {
          await sleep(2000);
        }
      } else {
        error(`Failed to connect after ${maxRetries} attempts`);
        throw new Error(
          `Cannot connect to Chrome on ${_host}:${_port}. ` +
          `Make sure Chrome is running with --remote-debugging-port=${_port}`
        );
      }
    }
  }

  throw new Error('Unreachable');
}

export async function disconnect(): Promise<void> {
  if (_client) {
    try { await _client.close(); } catch {}
    _client = null;
    info('CDP disconnected');
  }
}

export function isConnected(): boolean {
  return _client !== null;
}

export async function getClient(): Promise<CDPClient> {
  if (!_client) {
    return connect({ port: _port, host: _host });
  }
  return _client;
}

/** 斷線後強制重連 */
export async function reconnect(): Promise<CDPClient> {
  if (_client) {
    try { await _client.close(); } catch {}
    _client = null;
  }
  return connect({ port: _port, host: _host, maxRetries: 3 });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
