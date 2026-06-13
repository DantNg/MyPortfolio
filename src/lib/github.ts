/**
 * Module lấy dữ liệu từ GitHub API (chạy lúc build).
 * - Lấy danh sách repo công khai của bạn
 * - Đọc README của từng repo và render sang HTML
 *
 * Tùy chọn: đặt biến môi trường GITHUB_TOKEN để tăng giới hạn
 * request (mặc định không token chỉ 60 request/giờ).
 */
import { marked } from 'marked';
import { SITE } from '../config';

const GH_API = 'https://api.github.com';

function ghHeaders(accept = 'application/vnd.github+json'): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    'User-Agent': 'astro-portfolio',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export interface Repo {
  name: string;
  slug: string;
  description: string | null;
  htmlUrl: string;
  homepage: string | null;
  language: string | null;
  stars: number;
  forks: number;
  topics: string[];
  updatedAt: string;
  defaultBranch: string;
}

/** Lấy toàn bộ repo công khai (bỏ fork và repo đã archive). */
export async function getRepos(): Promise<Repo[]> {
  const username = SITE.githubUsername;
  try {
    const res = await fetch(
      `${GH_API}/users/${username}/repos?per_page=100&sort=updated&type=owner`,
      { headers: ghHeaders() }
    );
    if (!res.ok) {
      console.warn(`[github] Không lấy được repo cho "${username}" (HTTP ${res.status}). Trang /repos sẽ trống.`);
      return [];
    }
    const data: any[] = await res.json();
    return data
      .filter((r) => !r.fork && !r.archived)
      .sort((a, b) => b.stargazers_count - a.stargazers_count || +new Date(b.updated_at) - +new Date(a.updated_at))
      .map((r) => ({
        name: r.name,
        slug: r.name,
        description: r.description,
        htmlUrl: r.html_url,
        homepage: r.homepage || null,
        language: r.language,
        stars: r.stargazers_count,
        forks: r.forks_count,
        topics: r.topics ?? [],
        updatedAt: r.updated_at,
        defaultBranch: r.default_branch ?? 'main',
      }));
  } catch (err) {
    console.warn('[github] Lỗi mạng khi lấy repo:', (err as Error).message);
    return [];
  }
}

/** Đổi link/ảnh tương đối trong README thành URL tuyệt đối tới repo. */
function absolutizeRelativeUrls(md: string, username: string, repo: string, branch: string): string {
  const raw = `https://raw.githubusercontent.com/${username}/${repo}/${branch}/`;
  const blob = `https://github.com/${username}/${repo}/blob/${branch}/`;
  const isAbsolute = (u: string) => /^(https?:|data:|mailto:|#)/i.test(u);
  const clean = (u: string) => u.replace(/^\.?\//, '');

  // Ảnh markdown: ![alt](path)
  md = md.replace(/!\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g, (m, alt, url, rest) =>
    isAbsolute(url) ? m : `![${alt}](${raw}${clean(url)}${rest})`
  );
  // Link markdown: [text](path)
  md = md.replace(/(^|[^!])\[([^\]]+)\]\(([^)\s]+)([^)]*)\)/g, (m, pre, text, url, rest) =>
    isAbsolute(url) ? m : `${pre}[${text}](${blob}${clean(url)}${rest})`
  );
  // Ảnh HTML: <img src="path">
  md = md.replace(/(<img[^>]+src=["'])([^"']+)(["'])/gi, (m, a, url, b) =>
    isAbsolute(url) ? m : `${a}${raw}${clean(url)}${b}`
  );
  return md;
}

export interface RepoReadme {
  html: string;
  hasReadme: boolean;
}

/** Lấy README của repo và render sang HTML. */
export async function getReadme(repo: string, branch = 'main'): Promise<RepoReadme> {
  const username = SITE.githubUsername;
  try {
    const res = await fetch(`${GH_API}/repos/${username}/${repo}/readme`, {
      headers: ghHeaders('application/vnd.github.raw'),
    });
    if (!res.ok) return { html: '', hasReadme: false };

    let md = await res.text();
    md = absolutizeRelativeUrls(md, username, repo, branch);

    marked.setOptions({ gfm: true, breaks: false });
    const html = await marked.parse(md);
    return { html, hasReadme: true };
  } catch (err) {
    console.warn(`[github] Không đọc được README của "${repo}":`, (err as Error).message);
    return { html: '', hasReadme: false };
  }
}
