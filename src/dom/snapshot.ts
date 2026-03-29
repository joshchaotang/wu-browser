/**
 * dom/snapshot.ts — 核心 DOM 提取模組
 *
 * 使用 CDP DOM domain + Runtime.callFunctionOn 提取頁面結構，
 * 壓縮到 <1000 token。
 *
 * v0.2: Shadow DOM, improved cookie consent, incremental snapshots
 */

import { getClient } from '../browser/connection.js';
import { pruneElements, formatElement, type RawElement } from './pruner.js';
import { estimateTokens } from '../utils/token-counter.js';
import { audit, debug } from '../utils/logger.js';
import { getCurrentProfile, type ModelProfile } from '../model-sense/index.js';
import { type SnapshotFormatConfig } from '../model-sense/profiles.js';

export interface SnapshotOptions {
  mode: 'interactive' | 'content' | 'full';
  maxTokens?: number;
  selector?: string;
  includeHidden?: boolean;
  autoAcceptCookies?: boolean;
  incremental?: boolean;
}

export interface SnapshotResult {
  tree: string;
  tokenCount: number;
  truncated: boolean;
  truncatedPercent?: number;
  url: string;
  title: string;
  elementCount: number;
  incrementalMode?: boolean;
  changedElements?: number;
  cookieBannerClosed?: boolean;
  /** Raw elements for JSON output mode */
  rawElements?: RawElement[];
}

export interface SnapshotJsonResult {
  url: string;
  title: string;
  mode: string;
  tokenCount: number;
  elementCount: number;
  truncated: boolean;
  incremental: boolean;
  elements: Array<{
    ref: string;
    role: string;
    name: string;
    href: string | null;
    type: string | null;
    placeholder?: string;
    value?: string;
    region?: string;
    shadow?: boolean;
  }>;
}

// ─── Incremental snapshot state ────────────────────────────────

interface ElementKey {
  role: string;
  name: string;
  region: string;
}

interface PreviousSnapshot {
  url: string;
  elements: ElementKey[];
  timestamp: number;
}

// In-memory store: tab URL → previous snapshot
const prevSnapshots = new Map<string, PreviousSnapshot>();

// ─── Domain-level incremental ─────────────────────────────────

interface DomainCache {
  domain: string;
  elementHashes: Set<string>;
  lastURL: string;
  timestamp: number;
}

const domainCaches = new Map<string, DomainCache>();

function getElementHash(el: RawElement): string {
  return `${el.role}:${el.name}:${el.href ?? ''}`;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function computeDomainIncremental(
  currentEls: RawElement[],
  cache: DomainCache
): { isDomainIncremental: boolean; newElements: RawElement[]; sharedCount: number } {
  const newElements: RawElement[] = [];
  let sharedCount = 0;

  for (const el of currentEls) {
    if (cache.elementHashes.has(getElementHash(el))) {
      sharedCount++;
    } else {
      newElements.push(el);
    }
  }

  const sharedRatio = currentEls.length > 0 ? sharedCount / currentEls.length : 0;
  return {
    isDomainIncremental: sharedRatio >= 0.3,
    newElements,
    sharedCount,
  };
}

function updateDomainCache(domain: string, elements: RawElement[], url: string): void {
  const hashes = new Set(elements.map(getElementHash));
  domainCaches.set(domain, {
    domain,
    elementHashes: hashes,
    lastURL: url,
    timestamp: Date.now(),
  });
}

// ─── Structural incremental (Level 3) ────────────────────────

interface StructuralCache {
  skeleton: string[];  // array of "role:region" per element
  elements: RawElement[];
  url: string;
  timestamp: number;
}

const structuralCaches = new Map<string, StructuralCache>();

function getElementSkeleton(el: RawElement): string {
  return `${el.role}:${el.region ?? 'other'}`;
}

function computeStructuralDiff(
  currentEls: RawElement[],
  cache: StructuralCache
): {
  isStructural: boolean;
  added: RawElement[];
  removed: RawElement[];
  changed: Array<{ current: RawElement; prev: RawElement }>;
  unchanged: number;
} | null {
  const currentSkeleton = currentEls.map(getElementSkeleton);
  const prevSkeleton = cache.skeleton;

  // Compute skeleton similarity
  const maxLen = Math.max(currentSkeleton.length, prevSkeleton.length);
  if (maxLen === 0) return null;

  let matchCount = 0;
  const minLen = Math.min(currentSkeleton.length, prevSkeleton.length);
  for (let i = 0; i < minLen; i++) {
    if (currentSkeleton[i] === prevSkeleton[i]) matchCount++;
  }

  const similarity = matchCount / maxLen;
  if (similarity < 0.7) return null;

  // Structural match! Now find actual diffs
  const added: RawElement[] = [];
  const removed: RawElement[] = [];
  const changed: Array<{ current: RawElement; prev: RawElement }> = [];
  let unchanged = 0;

  for (let i = 0; i < minLen; i++) {
    if (currentSkeleton[i] === prevSkeleton[i]) {
      // Same skeleton position — check if content changed
      const curr = currentEls[i];
      const prev = cache.elements[i];
      if (curr.name !== prev.name || (curr.href ?? '') !== (prev.href ?? '')) {
        changed.push({ current: curr, prev });
      } else {
        unchanged++;
      }
    } else {
      added.push(currentEls[i]);
    }
  }

  // Extra elements in current
  for (let i = minLen; i < currentEls.length; i++) {
    added.push(currentEls[i]);
  }

  // Extra elements in prev (removed)
  for (let i = minLen; i < cache.elements.length; i++) {
    removed.push(cache.elements[i]);
  }

  return { isStructural: true, added, removed, changed, unchanged };
}

function updateStructuralCache(elements: RawElement[], url: string): void {
  const domain = getDomain(url);
  if (!domain) return;
  structuralCaches.set(domain, {
    skeleton: elements.map(getElementSkeleton),
    elements: elements.map(el => ({ ...el })),
    url,
    timestamp: Date.now(),
  });
}

/** Load snapshot cache from external storage (for CLI cross-process incremental) */
export function loadSnapshotCache(data: {
  snapshots?: Record<string, PreviousSnapshot>;
  domains?: Record<string, { domain: string; elementHashes: string[]; lastURL: string; timestamp: number }>;
}): void {
  prevSnapshots.clear();
  if (data.snapshots) {
    for (const [key, val] of Object.entries(data.snapshots)) {
      prevSnapshots.set(key, val);
    }
  }
  // Legacy format support
  if (!data.snapshots && !data.domains) {
    for (const [key, val] of Object.entries(data as Record<string, PreviousSnapshot>)) {
      prevSnapshots.set(key, val);
    }
  }
  domainCaches.clear();
  if (data.domains) {
    for (const [key, val] of Object.entries(data.domains)) {
      domainCaches.set(key, {
        domain: val.domain,
        elementHashes: new Set(val.elementHashes),
        lastURL: val.lastURL,
        timestamp: val.timestamp,
      });
    }
  }
}

/** Export snapshot cache for external storage */
export function saveSnapshotCache(): {
  snapshots: Record<string, PreviousSnapshot>;
  domains: Record<string, { domain: string; elementHashes: string[]; lastURL: string; timestamp: number }>;
} {
  const snapshots: Record<string, PreviousSnapshot> = {};
  for (const [key, val] of prevSnapshots.entries()) {
    snapshots[key] = val;
  }
  const domains: Record<string, { domain: string; elementHashes: string[]; lastURL: string; timestamp: number }> = {};
  for (const [key, val] of domainCaches.entries()) {
    domains[key] = {
      domain: val.domain,
      elementHashes: [...val.elementHashes],
      lastURL: val.lastURL,
      timestamp: val.timestamp,
    };
  }
  return { snapshots, domains };
}

function elementKey(el: RawElement): string {
  return `${el.role}|${el.name}|${el.region ?? 'other'}`;
}

function computeIncremental(
  currentEls: RawElement[],
  prev: PreviousSnapshot
): { isIncremental: boolean; changed: RawElement[]; unchangedCount: number } {
  const prevKeys = new Set(prev.elements.map(e => `${e.role}|${e.name}|${e.region}`));
  const changed: RawElement[] = [];
  let matchCount = 0;

  for (const el of currentEls) {
    if (prevKeys.has(elementKey(el))) {
      matchCount++;
    } else {
      changed.push(el);
    }
  }

  const matchRatio = currentEls.length > 0 ? matchCount / currentEls.length : 0;
  const isIncremental = matchRatio >= 0.7;
  return { isIncremental, changed, unchangedCount: matchCount };
}

// ─── Session stats (consumed by mcp/server.ts) ────────────────

export const sessionStats = {
  actions: 0,
  snapshots: 0,
  totalTokens: 0,
  cookieBannersClosed: 0,
  permissionPrompts: { green: 0, yellow: 0, red: 0, blocked: 0 },
  lastSnapshot: null as null | {
    url: string; tokenCount: number; elementCount: number; mode: string; timestamp: string;
  },
};

/** Generate token cost info for MCP responses */
export function getTokenCost(thisActionTokens: number): {
  thisAction: number;
  sessionTotal: number;
  snapshotsInSession: number;
  avgTokensPerSnapshot: number;
} {
  return {
    thisAction: thisActionTokens,
    sessionTotal: sessionStats.totalTokens,
    snapshotsInSession: sessionStats.snapshots,
    avgTokensPerSnapshot: sessionStats.snapshots > 0
      ? Math.round(sessionStats.totalTokens / sessionStats.snapshots)
      : 0,
  };
}

// ─── 頁面注入腳本 ────────────────────────────────────────────

/**
 * interactive 模式：提取可互動元素（含 Shadow DOM）
 * 同時設定 window.__wuRefs 供 actions 模組使用。
 */
const EXTRACT_INTERACTIVE = `(function() {
  var results = [];
  var idx = 0;
  var seen = new WeakSet();

  function getAccessibleName(el) {
    var label = el.getAttribute('aria-label');
    if (label) return label.trim();

    var labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      var ids = labelledBy.split(' ');
      var texts = ids.map(function(id) {
        var el2 = document.getElementById(id);
        return el2 ? el2.textContent.trim() : '';
      }).filter(Boolean);
      if (texts.length) return texts.join(' ');
    }

    var id = el.id;
    if (id) {
      var label2 = document.querySelector('label[for="' + id + '"]');
      if (label2) return (label2.textContent || '').trim();
    }

    var title = el.getAttribute('title');
    if (title) return title.trim();

    var alt = el.getAttribute('alt');
    if (alt) return alt.trim();

    var placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();

    var text = getCleanText(el).trim();
    if (text) return text.substring(0, 80);

    return el.getAttribute('name') || '';
  }

  function getCleanText(el) {
    var parts = [];
    var children = el.childNodes;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.nodeType === 3) {
        var t = (child.textContent || '').trim();
        if (t) parts.push(t);
      } else if (child.nodeType === 1) {
        var childTag = (child.tagName || '').toLowerCase();
        if (childTag !== 'style' && childTag !== 'script' && childTag !== 'noscript') {
          var childText = getCleanText(child).trim();
          if (childText) parts.push(childText);
        }
      }
    }
    return parts.join(' ');
  }

  function getRole(el) {
    var ariaRole = el.getAttribute('role');
    if (ariaRole) return ariaRole;
    var tag = el.tagName.toLowerCase();
    var type = el.getAttribute('type') || '';
    if (tag === 'button') return 'button';
    if (tag === 'a') return 'link';
    if (tag === 'input') {
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'search') return 'searchbox';
      return 'textbox';
    }
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    return tag;
  }

  function isVisible(el) {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.hasAttribute('hidden')) return false;
    try {
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (parseFloat(style.opacity) < 0.01) return false;
    } catch(e) { return false; }
    return true;
  }

  function getRegion(el) {
    var ancestor = el;
    while (ancestor && ancestor !== document.body) {
      var tag = ancestor.tagName ? ancestor.tagName.toLowerCase() : '';
      var role = ancestor.getAttribute ? ancestor.getAttribute('role') : null;
      if (tag === 'main' || role === 'main') return 'main';
      if (tag === 'article' || role === 'article') return 'main';
      if (tag === 'header' || role === 'banner') return 'header';
      if (tag === 'nav' || role === 'navigation') return 'nav';
      if (tag === 'aside' || role === 'complementary') return 'aside';
      if (tag === 'footer' || role === 'contentinfo') return 'footer';
      ancestor = ancestor.parentElement;
    }
    return 'other';
  }

  var SELECTORS = [
    'button:not([disabled]):not([aria-hidden="true"])',
    'a[href]:not([aria-hidden="true"])',
    'input:not([type="hidden"]):not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[role="button"]:not([aria-disabled="true"])',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="tab"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="combobox"]',
    '[role="textbox"]',
    '[role="searchbox"]',
    '[role="spinbutton"]',
    '[tabindex="0"]:not(a):not(button):not(input):not(select):not(textarea)'
  ].join(',');

  window.__wuRefs = {};

  function addElement(el, isShadow) {
    if (seen.has(el)) return;
    seen.add(el);
    if (!isVisible(el)) return;

    idx++;
    var ref = '@e' + idx;
    var role = getRole(el);
    var name = getAccessibleName(el);

    var item = {
      ref: ref,
      role: role,
      name: name.substring(0, 100),
      region: getRegion(el)
    };

    if (isShadow) item.shadow = true;

    var href = el.getAttribute('href');
    if (href && href !== '#' && href.indexOf('javascript:') !== 0) {
      item.href = href.length > 60 ? href.substring(0, 60) + '..' : href;
    }

    var elType = el.getAttribute('type');
    if (elType && elType !== 'text' && elType !== 'button' && elType !== 'submit') {
      item.type = elType;
    }

    var ph = el.getAttribute('placeholder');
    if (ph && ph !== name) item.placeholder = ph;

    window.__wuRefs[ref] = el;
    results.push(item);
  }

  // Walk regular DOM
  var elements = Array.from(document.querySelectorAll(SELECTORS));
  for (var i = 0; i < elements.length; i++) {
    addElement(elements[i], false);
  }

  // Walk Shadow DOM recursively (depth limit: 5)
  function walkShadowRoots(root, depth) {
    if (depth > 5) return;
    var all;
    try {
      all = Array.from(root.querySelectorAll('*'));
    } catch(e) { return; }

    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.shadowRoot) {
        // Collect interactive elements from this shadow root
        try {
          var shadowEls = Array.from(el.shadowRoot.querySelectorAll(SELECTORS));
          for (var j = 0; j < shadowEls.length; j++) {
            addElement(shadowEls[j], true);
          }
        } catch(e) {}
        // Recurse deeper
        walkShadowRoots(el.shadowRoot, depth + 1);
      }
    }
  }
  walkShadowRoots(document, 0);

  // Walk same-origin iframes (depth limit: 3)
  function walkIframes(doc, framePrefix, depth) {
    if (depth > 3) return;
    var iframes;
    try {
      iframes = Array.from(doc.querySelectorAll('iframe'));
    } catch(e) { return; }

    for (var fi = 0; fi < iframes.length; fi++) {
      var iframe = iframes[fi];
      var contentDoc;
      try {
        contentDoc = iframe.contentDocument;
        if (!contentDoc) continue; // cross-origin
      } catch(e) { continue; } // cross-origin security error

      var fPrefix = framePrefix ? framePrefix + '.' + (fi + 1) : 'f' + (fi + 1);
      try {
        var iframeEls = Array.from(contentDoc.querySelectorAll(SELECTORS));
        for (var k = 0; k < iframeEls.length; k++) {
          var iel = iframeEls[k];
          if (seen.has(iel)) continue;
          seen.add(iel);
          if (!isVisible(iel)) continue;
          idx++;
          var iref = '@' + fPrefix + '.e' + idx;
          var irole = getRole(iel);
          var iname = getAccessibleName(iel);
          var iitem = {
            ref: iref,
            role: irole,
            name: iname.substring(0, 100),
            region: getRegion(iel),
            iframe: fPrefix
          };
          var ihref = iel.getAttribute('href');
          if (ihref && ihref !== '#' && ihref.indexOf('javascript:') !== 0) {
            iitem.href = ihref.length > 60 ? ihref.substring(0, 60) + '..' : ihref;
          }
          window.__wuRefs[iref] = iel;
          results.push(iitem);
        }
      } catch(e) {}

      // Recurse into nested iframes
      walkIframes(contentDoc, fPrefix, depth + 1);
    }
  }
  walkIframes(document, '', 0);

  // Detect cookie banners (for reporting)
  var cookieSelectors = [
    '[class*="cookie"]','[id*="cookie"]',
    '[class*="consent"]','[id*="consent"]',
    '[class*="gdpr"]','[id*="gdpr"]',
    '[class*="CookieBanner"]','[class*="cc-banner"]',
    '[class*="cookie-notice"]','[id*="cookie-notice"]',
    '[id*="onetrust"]','[class*="onetrust"]',
    '[id*="CybotCookiebot"]','[class*="CybotCookiebot"]',
    '[class*="sp_choice"]',
    '[class*="evidon"]'
  ].join(',');

  var cookieBanners = [];
  try {
    var bannerEls = Array.from(document.querySelectorAll(cookieSelectors));
    for (var j = 0; j < bannerEls.length; j++) {
      var b = bannerEls[j];
      if (!isVisible(b)) continue;
      cookieBanners.push({
        selector: b.id ? '#' + b.id : (b.className ? '.' + b.className.split(' ')[0] : b.tagName.toLowerCase()),
        text: (b.textContent || '').trim().substring(0, 80)
      });
    }
  } catch(e) {}

  return {
    url: window.location.href,
    title: document.title,
    elements: results,
    cookieBanners: cookieBanners.slice(0, 3)
  };
})()`;

/** content 模式：提取主要文字內容 */
const EXTRACT_CONTENT = `(function() {
  var CONTENT_SELS = [
    'main','article','[role="main"]','[role="article"]',
    '#main','#content','.main','.content',
    '.post-content','.article-body','.entry-content','.post-body'
  ];
  var mainEl = null;
  for (var i = 0; i < CONTENT_SELS.length; i++) {
    mainEl = document.querySelector(CONTENT_SELS[i]);
    if (mainEl) break;
  }
  if (!mainEl) mainEl = document.body;

  var SKIP_TAGS = ['script','style','nav','footer','aside','noscript','iframe','svg','figure'];

  function extractText(el, depth) {
    if (depth > 30) return '';
    var tag = (el.tagName || '').toLowerCase();
    if (SKIP_TAGS.indexOf(tag) !== -1) return '';
    try {
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return '';
    } catch(e) {}
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return '';

    var parts = [];
    var children = el.childNodes;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.nodeType === 3) {
        var t = (child.textContent || '').trim();
        if (t) parts.push(t);
      } else if (child.nodeType === 1) {
        var childText = extractText(child, depth + 1);
        if (childText) {
          var ct = (child.tagName || '').toLowerCase();
          var isBlock = ['p','h1','h2','h3','h4','h5','h6','li','div','section','article','blockquote','pre'].indexOf(ct) !== -1;
          parts.push(isBlock ? '\\n' + childText + '\\n' : childText);
        }
      }
    }
    return parts.join(' ');
  }

  var content = extractText(mainEl, 0)
    .replace(/\\s+/g, ' ')
    .replace(/ \\n /g, '\\n')
    .replace(/\\n{3,}/g, '\\n\\n')
    .trim()
    .substring(0, 12000);

  return {
    url: window.location.href,
    title: document.title,
    content: content
  };
})()`;

/** full 模式：提取完整 AX-like tree */
const EXTRACT_FULL = `(function() {
  var idx = 0;
  window.__wuRefs = {};

  function isVisible(el) {
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
    if (el.hasAttribute && el.hasAttribute('hidden')) return false;
    try {
      var s = window.getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
    } catch(e) {}
    return true;
  }

  function walk(el, depth) {
    if (depth > 15 || !el) return null;
    if (!isVisible(el)) return null;

    var tag = (el.tagName || '').toLowerCase();
    var SKIP = ['script','style','noscript','svg','iframe'];
    if (SKIP.indexOf(tag) !== -1) return null;

    var role = el.getAttribute ? el.getAttribute('role') : null;
    var name = el.getAttribute ? (el.getAttribute('aria-label') || el.getAttribute('alt') || (el.textContent || '').trim().substring(0, 60)) : '';

    var node = { tag: tag, role: role, name: name, children: [] };

    var isInteractive = ['button','a','input','select','textarea'].indexOf(tag) !== -1 ||
      (role && ['button','link','menuitem','option','tab','checkbox','radio','combobox','textbox'].indexOf(role) !== -1);

    if (isInteractive) {
      idx++;
      var ref = '@e' + idx;
      node.ref = ref;
      window.__wuRefs[ref] = el;
    }

    if (depth < 10) {
      var children = el.children;
      for (var i = 0; i < children.length && node.children.length < 20; i++) {
        var child = walk(children[i], depth + 1);
        if (child) node.children.push(child);
      }
    }

    return node;
  }

  var tree = walk(document.body, 0);

  return {
    url: window.location.href,
    title: document.title,
    tree: tree
  };
})()`;

// ─── Cookie Consent 自動接受 ────────────────────────────────────

const AUTO_ACCEPT_COOKIES = `(function() {
  var ACCEPT_TEXTS = [
    'accept all','accept cookies','i accept','i agree','agree','ok',
    'got it','allow all','allow cookies','close','dismiss',
    'accept','allow','continue','proceed',
    '接受','同意','確認','關閉','好','全部接受',
    'accetto','akzeptieren','accepter','aceptar',
    'alle akzeptieren','tout accepter','aceptar todo'
  ];

  function findAcceptBtn(container) {
    var btns = Array.from(container.querySelectorAll('button, a[href], [role="button"]'));
    // Sort: prefer buttons with 'accept'/'allow' over 'close'/'dismiss'
    btns.sort(function(a, b) {
      var aText = (a.textContent || a.getAttribute('aria-label') || '').toLowerCase();
      var bText = (b.textContent || b.getAttribute('aria-label') || '').toLowerCase();
      var aScore = (aText.indexOf('accept') !== -1 || aText.indexOf('allow') !== -1 || aText.indexOf('agree') !== -1) ? 1 : 0;
      var bScore = (bText.indexOf('accept') !== -1 || bText.indexOf('allow') !== -1 || bText.indexOf('agree') !== -1) ? 1 : 0;
      return bScore - aScore;
    });
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      var text = (btn.textContent || btn.getAttribute('aria-label') || '').trim().toLowerCase();
      if (ACCEPT_TEXTS.some(function(t) { return text.indexOf(t) !== -1; })) {
        return btn;
      }
    }
    return null;
  }

  var cookieSelectors = [
    // Generic
    '[class*="cookie"]','[id*="cookie"]',
    '[class*="consent"]','[id*="consent"]',
    '[class*="gdpr"]','[id*="gdpr"]',
    '[class*="CookieBanner"]','[class*="cc-banner"]',
    '[class*="cookie-notice"]','[id*="cookie-notice"]',
    '[class*="cookie-law"]',
    // OneTrust (enterprise)
    '#onetrust-banner-sdk','#onetrust-accept-btn-handler',
    '[class*="onetrust"]','[id*="onetrust"]',
    // Cookiebot
    '#CybotCookiebotDialogBodyButtonAccept',
    '[id*="CybotCookiebot"]','[class*="CybotCookiebot"]',
    // SourcePoint
    '[class*="sp_choice"]','[class*="sp-choice"]',
    // Crownpeak/Evidon
    '[class*="evidon"]',
    // Common IDs
    '#cookiebanner','#cookie-banner','#cookie-notice',
    '.cookie-law-info-bar','.cc-window','.cc-banner'
  ].join(',');

  var accepted = false;
  var banners = Array.from(document.querySelectorAll(cookieSelectors));
  for (var i = 0; i < banners.length; i++) {
    var banner = banners[i];
    var s = window.getComputedStyle(banner);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    var btn = findAcceptBtn(banner);
    if (btn) {
      btn.click();
      accepted = true;
      break;
    }
  }
  return accepted;
})()`;

// ─── Mini-snapshot (after actions) ───────────────────────────

const MINI_SNAPSHOT_SCRIPT = `(function() {
  // Check for dialogs
  var dialogs = [];
  var dialogEls = Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog'));
  for (var i = 0; i < dialogEls.length; i++) {
    var d = dialogEls[i];
    try {
      var s = window.getComputedStyle(d);
      if (s.display !== 'none' && s.visibility !== 'hidden') {
        var btns = Array.from(d.querySelectorAll('button,[role="button"]')).slice(0, 4).map(function(b) {
          return (b.textContent || b.getAttribute('aria-label') || '').trim().substring(0, 40);
        }).filter(Boolean);
        dialogs.push({
          text: (d.textContent || '').trim().substring(0, 100),
          buttons: btns
        });
      }
    } catch(e) {}
  }

  return {
    url: window.location.href,
    title: document.title,
    dialogs: dialogs
  };
})()`;

// ─── 主 snapshot 函數 ────────────────────────────────────────────

export async function snapshot(opts: SnapshotOptions): Promise<SnapshotResult> {
  const maxTokens = opts.maxTokens ?? 1500;
  const autoAcceptCookies = opts.autoAcceptCookies !== false;
  const useIncremental = opts.incremental !== false;

  const client = await getClient();
  const { Runtime } = client;

  // 自動處理 cookie banner
  let cookieBannerClosed = false;
  if (autoAcceptCookies && opts.mode !== 'full') {
    try {
      const cookieResult = await Runtime.evaluate({
        expression: AUTO_ACCEPT_COOKIES,
        returnByValue: true,
      });
      cookieBannerClosed = !!cookieResult.result.value;
      if (cookieBannerClosed) {
        sessionStats.cookieBannersClosed++;
        await sleep(400);
      }
    } catch (e) {
      debug(`Cookie accept failed: ${e}`);
    }
  }

  let result: SnapshotResult;

  if (opts.mode === 'content') {
    result = await extractContent(maxTokens);
  } else if (opts.mode === 'full') {
    result = await extractFull(maxTokens);
  } else {
    result = await extractInteractive(maxTokens, opts.selector, useIncremental);
  }

  result.cookieBannerClosed = cookieBannerClosed;

  // Update session stats
  sessionStats.snapshots++;
  sessionStats.totalTokens += result.tokenCount;
  sessionStats.lastSnapshot = {
    url: result.url,
    tokenCount: result.tokenCount,
    elementCount: result.elementCount,
    mode: opts.mode,
    timestamp: new Date().toISOString(),
  };

  return result;
}

async function extractInteractive(
  maxTokens: number,
  selector?: string,
  useIncremental = true
): Promise<SnapshotResult> {
  const client = await getClient();
  const { Runtime, Page } = client;

  // Get current ModelSense profile for format decisions
  const profile = getCurrentProfile();
  const fmt = profile.snapshotFormat;
  // Use profile's optimalMaxTokens if caller used default
  const effectiveMaxTokens = maxTokens === 1500 ? profile.optimalMaxTokens : maxTokens;

  let url = 'about:blank';

  try {
    const frame = await Page.getFrameTree();
    url = frame.frameTree.frame.url;
  } catch {}

  const script = selector
    ? EXTRACT_INTERACTIVE.replace(
        'document.querySelectorAll(SELECTORS)',
        `(document.querySelector(${JSON.stringify(selector)}) || document).querySelectorAll(SELECTORS)`
      )
    : EXTRACT_INTERACTIVE;

  const result = await Runtime.evaluate({
    expression: script,
    returnByValue: true,
    awaitPromise: false,
  });

  if (result.exceptionDetails) {
    throw new Error(`Snapshot failed: ${result.exceptionDetails.text}`);
  }

  const data = result.result.value as {
    url: string;
    title: string;
    elements: RawElement[];
    cookieBanners: Array<{ selector: string; text: string }>;
  };

  url = data.url;
  const title = data.title;
  const allRawElements = data.elements;

  // Check previous snapshot for incremental mode (Level 1: URL-level)
  const prev = prevSnapshots.get(url);
  let incrementalMode = false;
  let domainIncrementalMode = false;
  let changedElements = allRawElements.length;

  // Prune elements (default path) — use effective maxTokens from profile
  const { elements, truncated, truncatedPercent, totalElements } = pruneElements(allRawElements, effectiveMaxTokens, fmt);

  const lines: string[] = [];

  // Level 1: URL-level incremental (same URL)
  if (useIncremental && prev && prev.url === url) {
    const inc = computeIncremental(elements, prev);
    if (inc.isIncremental) {
      incrementalMode = true;
      changedElements = inc.changed.length;

      lines.push(`[頁面] ${title} (${url})`);
      lines.push('---');
      lines.push(`[增量更新 · ${inc.changed.length} 個變化 / ${elements.length} 個元素]`);

      if (inc.changed.length > 0) {
        for (const el of inc.changed) {
          lines.push(formatElement(el, fmt));
        }
      } else {
        lines.push('[無變化]');
      }

      if (inc.unchangedCount > 0) {
        lines.push(`[... ${inc.unchangedCount} 個元素未變化]`);
      }
      lines.push('---');
      lines.push(`[${elements.length} 個元素 · 增量模式]`);
    }
  }

  // Level 2: Domain-level incremental (different URL, same domain)
  // Compare RAW elements (before pruning) to catch shared header/nav/footer
  if (!incrementalMode && useIncremental) {
    const domain = getDomain(url);
    if (domain) {
      const domainCache = domainCaches.get(domain);
      if (domainCache && domainCache.lastURL !== url) {
        const domInc = computeDomainIncremental(allRawElements, domainCache);
        if (domInc.isDomainIncremental && domInc.sharedCount > 0) {
          // Prune only the new (non-shared) elements
          const { elements: prunedNew } = pruneElements(domInc.newElements, effectiveMaxTokens, fmt);
          domainIncrementalMode = true;
          changedElements = prunedNew.length;

          lines.push(`[頁面] ${title} (${url})`);
          lines.push('---');
          lines.push(`[域級增量 · ${domain} · ${domInc.sharedCount} 個共用元素省略 · ${prunedNew.length} 個新元素]`);

          for (const el of prunedNew) {
            lines.push(formatElement(el, fmt));
          }

          if (domInc.sharedCount > 0) {
            lines.push(`[... ${domInc.sharedCount} 個元素與上一頁共用]`);
          }
          lines.push('---');
          lines.push(`[${allRawElements.length} 個元素 · 域級增量模式]`);
        }
      }
    }
  }

  // Level 3: Structural incremental (same domain, similar skeleton)
  let structuralMode = false;
  if (!incrementalMode && !domainIncrementalMode && useIncremental) {
    const domain = getDomain(url);
    if (domain) {
      const structCache = structuralCaches.get(domain);
      if (structCache && structCache.url !== url) {
        const diff = computeStructuralDiff(elements, structCache);
        if (diff && diff.isStructural) {
          structuralMode = true;
          const totalChanges = diff.added.length + diff.changed.length;
          changedElements = totalChanges;

          lines.push(`[頁面] ${title} (${url})`);
          lines.push('---');
          lines.push(`[structural-diff from ${structCache.url}] +${diff.added.length} -${diff.removed.length} ~${diff.changed.length} elements`);

          if (diff.changed.length > 0) {
            lines.push('[變化元素]');
            for (const c of diff.changed) {
              lines.push(formatElement(c.current, fmt));
            }
          }
          if (diff.added.length > 0) {
            lines.push('[新增元素]');
            for (const a of diff.added) {
              lines.push(formatElement(a, fmt));
            }
          }
          if (diff.unchanged > 0) {
            lines.push(`[... ${diff.unchanged} 個元素未變化]`);
          }
          lines.push('---');
          lines.push(`[${elements.length} 個元素 · structural-diff 模式]`);
        }
      }
    }
  }

  // Level 4: Full snapshot (no incremental match)
  if (!incrementalMode && !domainIncrementalMode && !structuralMode) {
    lines.push(`[頁面] ${title} (${url})`);
    lines.push('---');

    for (const el of elements) {
      lines.push(formatElement(el, fmt));
    }

    lines.push('---');

    const suffix = truncated
      ? `[... 裁剪 ${truncatedPercent}% · 共 ${totalElements} 個元素 · 用 --max-tokens 提高上限]`
      : `[${elements.length} 個元素 · interactive 模式]`;

    lines.push(suffix);
  }

  const tree = lines.join('\n');
  const tokenCount = estimateTokens(tree);

  // Save current snapshot for next incremental diff
  prevSnapshots.set(url, {
    url,
    elements: elements.map(e => ({ role: e.role, name: e.name, region: e.region ?? 'other' })),
    timestamp: Date.now(),
  });

  // Update domain cache with ALL raw elements (not just pruned)
  const domain = getDomain(url);
  if (domain) {
    updateDomainCache(domain, allRawElements, url);
  }

  // Update structural cache
  updateStructuralCache(elements, url);

  const modeLabel = incrementalMode ? ' [incremental]' : domainIncrementalMode ? ' [domain-incremental]' : structuralMode ? ' [structural-diff]' : '';
  audit('SNAPSHOT', `interactive ${tokenCount}tokens${modeLabel}`);

  return {
    tree,
    tokenCount,
    truncated: domainIncrementalMode ? false : truncated,
    truncatedPercent: (truncated && !domainIncrementalMode) ? truncatedPercent : undefined,
    url,
    title,
    elementCount: domainIncrementalMode ? allRawElements.length : elements.length,
    incrementalMode: incrementalMode || domainIncrementalMode || structuralMode,
    changedElements,
    rawElements: elements,
  };
}

/** Strip control characters that break JSON serialization */
function sanitizeString(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Convert a SnapshotResult to structured JSON format */
export function snapshotToJson(result: SnapshotResult, mode: string): SnapshotJsonResult {
  return {
    url: result.url,
    title: sanitizeString(result.title),
    mode,
    tokenCount: result.tokenCount,
    elementCount: result.elementCount,
    truncated: result.truncated,
    incremental: result.incrementalMode ?? false,
    elements: (result.rawElements ?? []).map(el => ({
      ref: el.ref,
      role: el.role,
      name: sanitizeString(el.name),
      href: el.href ?? null,
      type: el.type ?? null,
      ...(el.placeholder ? { placeholder: sanitizeString(el.placeholder) } : {}),
      ...(el.value ? { value: sanitizeString(el.value) } : {}),
      ...(el.region ? { region: el.region } : {}),
      ...(el.shadow ? { shadow: el.shadow } : {}),
    })),
  };
}

async function extractContent(maxTokens: number): Promise<SnapshotResult> {
  const client = await getClient();
  const { Runtime } = client;

  const result = await Runtime.evaluate({
    expression: EXTRACT_CONTENT,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    throw new Error(`Content extraction failed: ${result.exceptionDetails.text}`);
  }

  const data = result.result.value as {
    url: string;
    title: string;
    content: string;
  };

  const maxChars = maxTokens * 4;
  const truncated = data.content.length > maxChars;
  const truncatedPercent = truncated
    ? Math.round(((data.content.length - maxChars) / data.content.length) * 100)
    : 0;

  const contentText = truncated
    ? data.content.substring(0, maxChars) + `\n[... 已裁剪 ${truncatedPercent}% · 用 full 模式查看完整內容]`
    : data.content;

  const tree = `[頁面] ${data.title} (${data.url})\n---\n${contentText}\n---\n[content 模式]`;
  const tokenCount = estimateTokens(tree);

  audit('SNAPSHOT', `content ${tokenCount}tokens`);

  return {
    tree,
    tokenCount,
    truncated,
    truncatedPercent: truncated ? truncatedPercent : undefined,
    url: data.url,
    title: data.title,
    elementCount: 0,
  };
}

async function extractFull(maxTokens: number): Promise<SnapshotResult> {
  const client = await getClient();
  const { Runtime } = client;

  const result = await Runtime.evaluate({
    expression: EXTRACT_FULL,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    throw new Error(`Full extraction failed: ${result.exceptionDetails.text}`);
  }

  const data = result.result.value as {
    url: string;
    title: string;
    tree: unknown;
  };

  const treeStr = JSON.stringify(data.tree, null, 2);
  const maxChars = maxTokens * 4;
  const truncated = treeStr.length > maxChars;
  const truncatedPercent = truncated
    ? Math.round(((treeStr.length - maxChars) / treeStr.length) * 100)
    : 0;

  const content = truncated
    ? treeStr.substring(0, maxChars) + `\n[... 已裁剪 ${truncatedPercent}%]`
    : treeStr;

  const tree = `[頁面] ${data.title} (${data.url})\n---\n${content}\n---\n[full 模式]`;
  const tokenCount = estimateTokens(tree);

  audit('SNAPSHOT', `full ${tokenCount}tokens`);

  return {
    tree,
    tokenCount,
    truncated,
    truncatedPercent: truncated ? truncatedPercent : undefined,
    url: data.url,
    title: data.title,
    elementCount: 0,
  };
}

/** 純文字提取（比 content 模式更省 token）*/
export async function getText(selector?: string): Promise<{ text: string; url: string; title: string }> {
  const client = await getClient();
  const { Runtime } = client;

  const target = selector
    ? `document.querySelector(${JSON.stringify(selector)}) || document.body`
    : 'document.body';

  const expr = `(function() {
    var el = ${target};
    return {
      url: window.location.href,
      title: document.title,
      text: (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().substring(0, 6000)
    };
  })()`;

  const result = await Runtime.evaluate({ expression: expr, returnByValue: true });
  return result.result.value as { text: string; url: string; title: string };
}

/** Mini-snapshot after an action: URL, title, dialogs */
export async function miniSnapshot(): Promise<{
  url: string;
  title: string;
  dialogs: Array<{ text: string; buttons: string[] }>;
}> {
  try {
    const client = await getClient();
    const { Runtime } = client;
    const result = await Runtime.evaluate({
      expression: MINI_SNAPSHOT_SCRIPT,
      returnByValue: true,
    });
    return result.result.value as {
      url: string;
      title: string;
      dialogs: Array<{ text: string; buttons: string[] }>;
    };
  } catch {
    return { url: '', title: '', dialogs: [] };
  }
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}
