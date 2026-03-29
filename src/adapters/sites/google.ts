/**
 * google.ts — Google Search adapter
 *
 * Commands:
 *   google/search "query" — Search Google and return structured results
 */

import type { SiteAdapter, BrowserAPI } from '../types.js';

interface SearchResult {
  rank: number;
  title: string;
  url: string;
  snippet: string;
}

async function search(args: string[], browser: BrowserAPI): Promise<SearchResult[]> {
  const query = args.join(' ');
  if (!query) {
    throw new Error('Usage: google/search <query>');
  }

  // Navigate directly to search results (most reliable approach)
  const navResult = await browser.navigate(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
  await browser.sleep(2500);

  // Verify we're on search results page
  const resultsSnap = await browser.snapshotJson({ maxTokens: 3000 });

  // If Google redirected us (e.g. cookie consent), try waiting and re-snapping
  if (!resultsSnap.url.includes('/search')) {
    await browser.sleep(2000);
    const retrySnap = await browser.snapshotJson({ maxTokens: 3000 });
    if (!retrySnap.url.includes('/search')) {
      return [{
        rank: 0,
        title: '(search failed)',
        url: retrySnap.url,
        snippet: `Google redirected to ${retrySnap.url}. Try navigating manually first.`,
      }];
    }
    return extractResults(retrySnap.elements);
  }

  return extractResults(resultsSnap.elements);
}

function extractResults(elements: Array<{ ref: string; role: string; name: string; href: string | null; type: string | null }>): SearchResult[] {
  const results: SearchResult[] = [];
  let rank = 0;
  const seenUrls = new Set<string>();

  // Google internal domains to filter out
  const googleDomains = [
    'google.com', 'google.co', 'accounts.google', 'support.google',
    'policies.google', 'maps.google', 'translate.google',
  ];

  for (const el of elements) {
    if (el.role !== 'link' || !el.href || !el.name || el.name.length <= 5) continue;

    // Skip Google's own links and navigation
    const isGoogleLink = googleDomains.some(d => el.href!.includes(d));
    if (isGoogleLink) continue;

    // Skip pagination, cached links, translation links
    if (el.href.includes('/search?')) continue;
    if (el.name.includes('翻譯這個網頁') || el.name.includes('Translate this page')) continue;

    // Deduplicate by base URL (strip timestamp fragments like &t=123)
    const baseUrl = el.href.replace(/[&?]t=\d+$/, '').replace(/\.\.?$/, '');
    if (seenUrls.has(baseUrl)) continue;
    seenUrls.add(baseUrl);

    // Skip YouTube timestamp links (not main results)
    if (el.href.includes('youtube.com/watch') && el.href.includes('&t=')) continue;

    // Skip very short or purely numeric titles (timestamp fragments)
    if (/^\d+\s*(秒|分鐘)/.test(el.name)) continue;
    if (/^[\d\s,。、秒分鐘的]+$/.test(el.name)) continue;

    rank++;
    results.push({
      rank,
      title: el.name,
      url: el.href,
      snippet: '',
    });
  }

  return results;
}

const adapter: SiteAdapter = {
  name: 'google',
  domains: [
    'google.com', 'google.co.jp', 'google.co.uk', 'google.de',
    'google.fr', 'google.es', 'google.it', 'google.com.br',
    'google.com.tw', 'google.co.kr', 'google.com.au',
  ],
  commands: [
    {
      name: 'search',
      description: 'Search Google and return structured results as JSON',
      execute: search,
    },
  ],
};

export default adapter;
