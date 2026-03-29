/**
 * github.ts — GitHub adapter
 *
 * Commands:
 *   github/repo "owner/name"   — Get repo info (stars, forks, description)
 *   github/issues "owner/name" — List recent issues
 */

import type { SiteAdapter, BrowserAPI } from '../types.js';

interface RepoInfo {
  name: string;
  description: string;
  url: string;
  stats: Record<string, string>;
  topics: string[];
  needsLogin: boolean;
}

interface IssueItem {
  number: string;
  title: string;
  url: string;
  labels: string[];
}

async function repo(args: string[], browser: BrowserAPI): Promise<RepoInfo> {
  const repoPath = args[0];
  if (!repoPath || !repoPath.includes('/')) {
    throw new Error('Usage: github/repo <owner/name> (e.g. github/repo "anthropics/claude-code")');
  }

  const url = `https://github.com/${repoPath}`;
  await browser.navigate(url);
  await browser.sleep(1500);

  const snap = await browser.snapshotJson({ maxTokens: 3000 });

  // Check if we got redirected to login
  if (snap.url.includes('github.com/login') || snap.url.includes('github.com/session')) {
    return {
      name: repoPath,
      description: 'Login required to view this repository',
      url,
      stats: {},
      topics: [],
      needsLogin: true,
    };
  }

  // Extract repo info from elements
  const stats: Record<string, string> = {};
  const topics: string[] = [];
  let description = '';

  for (const el of snap.elements) {
    const name = (el.name ?? '').toLowerCase();
    // Stars, forks, watchers are typically links
    if (el.role === 'link') {
      if (name.includes('star')) {
        stats.stars = el.name ?? '';
      } else if (name.includes('fork')) {
        stats.forks = el.name ?? '';
      } else if (name.includes('watch')) {
        stats.watchers = el.name ?? '';
      }
      // Topics are links in the topic area
      if (el.href && el.href.includes('/topics/')) {
        topics.push(el.name ?? '');
      }
    }
  }

  // Get description from page text
  const textResult = await browser.getText('article, [data-testid="repo-description"], .f4.my-3, p.f4');
  if (textResult.text && textResult.text.length > 0 && textResult.text.length < 500) {
    description = textResult.text.substring(0, 300);
  }

  return {
    name: repoPath,
    description: description || '(no description available)',
    url: snap.url,
    stats,
    topics,
    needsLogin: false,
  };
}

async function issues(args: string[], browser: BrowserAPI): Promise<{ issues: IssueItem[]; needsLogin: boolean }> {
  const repoPath = args[0];
  if (!repoPath || !repoPath.includes('/')) {
    throw new Error('Usage: github/issues <owner/name>');
  }

  const url = `https://github.com/${repoPath}/issues`;
  await browser.navigate(url);
  await browser.sleep(1500);

  const snap = await browser.snapshotJson({ maxTokens: 3000 });

  if (snap.url.includes('github.com/login') || snap.url.includes('github.com/session')) {
    return { issues: [], needsLogin: true };
  }

  const issueList: IssueItem[] = [];

  for (const el of snap.elements) {
    if (el.role === 'link' && el.href) {
      const issueMatch = el.href.match(/\/issues\/(\d+)/);
      if (issueMatch && el.name && el.name.length > 3) {
        issueList.push({
          number: `#${issueMatch[1]}`,
          title: el.name,
          url: el.href.startsWith('http') ? el.href : `https://github.com${el.href}`,
          labels: [],
        });
      }
    }
  }

  return { issues: issueList, needsLogin: false };
}

const adapter: SiteAdapter = {
  name: 'github',
  domains: ['github.com'],
  commands: [
    {
      name: 'repo',
      description: 'Get repository info (name, description, stars, forks, topics)',
      execute: repo,
    },
    {
      name: 'issues',
      description: 'List recent issues for a repository',
      execute: issues,
    },
  ],
};

export default adapter;
