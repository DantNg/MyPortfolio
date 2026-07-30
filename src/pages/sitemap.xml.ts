/**
 * Sitemap tự sinh, tại /sitemap.xml
 *
 * Vì sao không dùng @astrojs/sitemap: package `sitemap` bên dưới nó từ chối
 * đường dẫn tuyệt đối làm `destinationDir`, nên build trên Windows luôn lỗi
 * ("destinationDir must be a relative path"). Tự sinh thì vừa hết lỗi, vừa
 * kiểm soát được ba thứ mà integration không cho:
 *
 *   1. `lastmod` đúng theo ngày của từng bài, không phải ngày build.
 *   2. Loại tường minh các URL chỉ để chuyển hướng (/blog, /lvgl/*) — đưa
 *      chúng vào sitemap là tự khai báo trang rác với Google.
 *   3. `priority` phản ánh cấu trúc site thật: trang chủ > bài học > trang phụ.
 */
import { getCollection } from 'astro:content';
import { SITE } from '../config';
import { SERIES, getSeries } from '../series';
import { url } from '../utils/url';
import { hasTranslation, localePath } from '../utils/i18nUrl';

interface Entry {
  path: string;
  lastmod?: Date;
  changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  priority: string;
}

export async function get() {
  /* Không dùng `context.site` ở đây: trong endpoint nó đã bao gồm `base`, nên
     cộng base thêm lần nữa sinh ra /MyPortfolio/MyPortfolio/. `url()` là nơi
     duy nhất biết về base — dùng nó cho nhất quán với toàn bộ site. */
  const origin = SITE.url.replace(/\/$/, '');
  const abs = (p: string) => `${origin}${url(p)}`;

  const entries: Entry[] = [];

  /* ---- Trang tĩnh. Không có /blog: nó chỉ 301 về / ---- */
  entries.push({ path: '/', changefreq: 'daily', priority: '1.0' });
  for (const p of ['/about', '/projects', '/resume', '/contact', '/repos']) {
    entries.push({ path: p, changefreq: 'monthly', priority: '0.6' });
  }

  /* ---- Bài viết lẻ ---- */
  const posts = await getCollection('blog', (p) => !p.data.draft);
  for (const p of posts) {
    entries.push({
      path: `/blog/${p.slug}`,
      lastmod: p.data.updatedDate ?? p.data.date,
      changefreq: 'yearly',
      priority: '0.8',
    });
  }

  /* ---- Series: trang tổng quan + từng bài học ---- */
  const lessons = await getCollection('series', (e) => !e.data.draft && e.data.lang === 'en');

  for (const s of SERIES) {
    entries.push({
      path: `/blog/series/${s.id}`,
      lastmod: new Date(s.published),
      changefreq: 'monthly',
      priority: '0.9',
    });
  }

  for (const l of lessons) {
    const [seriesId, , slug] = l.slug.split('/');
    const meta = getSeries(seriesId);
    if (!meta) continue;
    entries.push({
      path: `/blog/series/${seriesId}/${slug}`,
      lastmod: new Date(meta.published),
      changefreq: 'monthly',
      /* Bài học là nội dung chính của site — ưu tiên cao hơn trang phụ */
      priority: '0.8',
    });
  }

  /* ---- Trang dự án ---- */
  const projects = await getCollection('projects');
  for (const p of projects) {
    entries.push({
      path: `/projects/${p.slug}`,
      lastmod: p.data.date,
      changefreq: 'yearly',
      priority: '0.7',
    });
  }

  /** URL tuyệt đối, luôn có '/' cuối để khớp canonical mà Astro sinh ra */
  const loc = (p: string) => {
    const u = abs(p);
    return u.endsWith('/') ? u : u + '/';
  };

  /**
   * Trang có bản dịch được khai HAI lần (một cho mỗi ngôn ngữ), và mỗi lần đều
   * kèm đủ bộ `xhtml:link` trỏ chéo. Google đòi quan hệ hai chiều: nếu bản
   * tiếng Việt khai bản tiếng Anh mà không có chiều ngược lại, cả cặp bị bỏ.
   */
  function block(e: Entry, lang: 'en' | 'vi'): string {
    const out = ['  <url>', `    <loc>${loc(localePath(e.path, lang))}</loc>`];

    if (hasTranslation(e.path)) {
      const alts: [string, string][] = [
        ['en', localePath(e.path, 'en')],
        ['vi', localePath(e.path, 'vi')],
        ['x-default', localePath(e.path, 'en')],
      ];
      for (const [code, path] of alts) {
        out.push(`    <xhtml:link rel="alternate" hreflang="${code}" href="${loc(path)}"/>`);
      }
    }

    if (e.lastmod) out.push(`    <lastmod>${e.lastmod.toISOString().slice(0, 10)}</lastmod>`);
    out.push(`    <changefreq>${e.changefreq}</changefreq>`);
    out.push(`    <priority>${e.priority}</priority>`);
    out.push('  </url>');
    return out.join('\n');
  }

  const blocks: string[] = [];
  for (const e of entries) {
    blocks.push(block(e, 'en'));
    if (hasTranslation(e.path)) blocks.push(block(e, 'vi'));
  }

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    blocks.join('\n') +
    '\n</urlset>\n';

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
