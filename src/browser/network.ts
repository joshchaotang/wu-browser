/**
 * browser/network.ts — Network request interception via CDP
 *
 * Uses CDP Network domain to capture requests and responses.
 * Useful for debugging API calls and understanding site behavior.
 */

import { getClient } from './connection.js';
import { debug } from '../utils/logger.js';

export interface CapturedRequest {
  id: string;
  url: string;
  method: string;
  type: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  timestamp: number;
}

let capturing = false;
const capturedRequests = new Map<string, CapturedRequest>();

export async function startCapture(): Promise<void> {
  if (capturing) return;
  const client = await getClient();
  const { Network } = client;

  capturedRequests.clear();

  await Network.enable({});

  Network.requestWillBeSent(({ requestId, request, type, timestamp }) => {
    capturedRequests.set(requestId, {
      id: requestId,
      url: request.url,
      method: request.method,
      type: type ?? 'Other',
      timestamp,
    });
  });

  Network.responseReceived(({ requestId, response }) => {
    const req = capturedRequests.get(requestId);
    if (req) {
      req.status = response.status;
      req.statusText = response.statusText;
      req.mimeType = response.mimeType;
    }
  });

  capturing = true;
  debug('Network capture started');
}

export async function stopCapture(): Promise<void> {
  if (!capturing) return;
  try {
    const client = await getClient();
    const { Network } = client;
    await Network.disable();
  } catch {
    // Connection may already be gone
  }
  capturing = false;
  debug('Network capture stopped');
}

export function isCapturing(): boolean {
  return capturing;
}

export function getCapturedRequests(): CapturedRequest[] {
  return Array.from(capturedRequests.values())
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function clearCapturedRequests(): void {
  capturedRequests.clear();
}
