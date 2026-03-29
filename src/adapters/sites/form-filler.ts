/**
 * form-filler.ts — Universal form detection and filling adapter
 *
 * Commands:
 *   form/detect             — Detect all form fields on current page
 *   form/fill --data '{}'   — Auto-match labels to refs and fill fields
 */

import type { SiteAdapter, BrowserAPI } from '../types.js';

interface FormField {
  ref: string;
  role: string;
  label: string;
  type: string | null;
  placeholder: string | null;
  value: string | null;
  region: string;
}

interface FillResult {
  filled: Array<{ ref: string; label: string; value: string }>;
  skipped: Array<{ label: string; reason: string }>;
  unmatched: string[];
}

async function detect(_args: string[], browser: BrowserAPI): Promise<{ fields: FormField[]; url: string }> {
  const snap = await browser.snapshotJson({ maxTokens: 3000 });

  const fields: FormField[] = [];

  for (const el of snap.elements) {
    // Form-fillable elements
    if (el.role === 'textbox' || el.role === 'searchbox' || el.role === 'combobox' ||
        el.role === 'checkbox' || el.role === 'radio' || el.role === 'slider' ||
        el.role === 'spinbutton') {
      fields.push({
        ref: el.ref,
        role: el.role,
        label: el.name ?? '',
        type: el.type ?? null,
        placeholder: el.placeholder ?? null,
        value: el.value ?? null,
        region: el.region ?? 'other',
      });
    }
  }

  return { fields, url: snap.url };
}

async function fill(args: string[], browser: BrowserAPI): Promise<FillResult> {
  // Parse --data argument
  let dataStr = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data' && i + 1 < args.length) {
      dataStr = args[i + 1];
      break;
    }
  }
  // If no --data flag, treat the first arg as JSON
  if (!dataStr && args.length > 0 && args[0] !== '--data') {
    dataStr = args[0];
  }

  if (!dataStr) {
    throw new Error('Usage: form/fill --data \'{"fieldLabel": "value", ...}\'');
  }

  let data: Record<string, string>;
  try {
    data = JSON.parse(dataStr);
  } catch {
    throw new Error(`Invalid JSON data: ${dataStr}`);
  }

  // Detect current fields
  const { fields } = await detect([], browser);

  const result: FillResult = {
    filled: [],
    skipped: [],
    unmatched: [],
  };

  const usedRefs = new Set<string>();

  // Match data keys to form fields by label/placeholder
  for (const [key, value] of Object.entries(data)) {
    const keyLower = key.toLowerCase();

    // Find best matching field
    const match = fields.find(f => {
      if (usedRefs.has(f.ref)) return false;
      const label = (f.label ?? '').toLowerCase();
      const placeholder = (f.placeholder ?? '').toLowerCase();
      return label.includes(keyLower) || keyLower.includes(label) ||
             placeholder.includes(keyLower) || keyLower.includes(placeholder) ||
             label === keyLower || placeholder === keyLower;
    });

    if (match) {
      if (match.role === 'checkbox' || match.role === 'radio') {
        // Click to toggle checkboxes/radios
        if (value === 'true' || value === '1' || value === 'yes') {
          await browser.click(match.ref);
          result.filled.push({ ref: match.ref, label: match.label, value });
        } else {
          result.skipped.push({ label: key, reason: 'checkbox/radio value is falsy' });
        }
      } else {
        // Type into text fields
        await browser.type(match.ref, value, { clear: true });
        result.filled.push({ ref: match.ref, label: match.label, value });
      }
      usedRefs.add(match.ref);
      await browser.sleep(200);
    } else {
      result.unmatched.push(key);
    }
  }

  return result;
}

const adapter: SiteAdapter = {
  name: 'form',
  domains: ['*'],
  commands: [
    {
      name: 'detect',
      description: 'Detect all form fields on the current page (labels, types, refs)',
      execute: detect,
    },
    {
      name: 'fill',
      description: 'Auto-fill form fields by matching labels to data keys. Usage: form/fill --data \'{"name": "Josh", "email": "user@example.com"}\'',
      execute: fill,
    },
  ],
};

export default adapter;
