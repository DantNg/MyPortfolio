/**
 * RSS feed tại /rss.xml
 *
 * Vì sao đáng làm cho SEO: feed là cách các trang tổng hợp (Feedly, lobste.rs,
 * planet-style aggregator, newsletter) lấy nội dung của bạn — và mỗi lần họ dẫn
 * lại là một backlink. Backlink thì ảnh hưởng xếp hạng thật, khác với tên miền.
 *
 * Feed gồm CẢ bài viết lẻ VÀ các bài học trong series, vì series chiếm phần lớn
 * nội dung. Bài học lấy tiêu đề/mô tả bản tiếng Anh cho đồng nhất một feed.
 */
import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { SITE } from '../config';
import { SERIES, getSeries } from '../series';

export async function get(context: APIContext) {
  const site = context.site?.toString().replace(/\/$/, '') ?? SITE.url;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');

  /** Đường dẫn tương đối kèm base — @astrojs/rss tự ghép với `site` */
  const link = (p: string) => `${base}${p}`;

  const items: Parameters<typeof rss>[0]['items'] = [];

  /* ---- Bài viết lẻ ---- */
  const posts = await getCollection('blog', (p) => !p.data.draft);
  for (const p of posts) {
    items.push({
      title: p.data.title,
      description: p.data.description,
      link: link(`/blog/${p.slug}/`),
      pubDate: p.data.date,
      categories: p.data.tags,
    });
  }

  /* ---- Bài học trong series (chỉ bản tiếng Anh, tránh trùng lặp feed) ---- */
  const lessons = await getCollection('series', (e) => !e.data.draft && e.data.lang === 'en');
  for (const l of lessons) {
    const [seriesId, , slug] = l.slug.split('/');
    const meta = getSeries(seriesId);
    if (!meta) continue;

    items.push({
      /* Có tiền tố series để người đọc feed biết ngay bài này thuộc đâu */
      title: `${meta.badge} · ${l.data.title}`,
      description: l.data.description,
      link: link(`/blog/series/${seriesId}/${slug}/`),
      pubDate: new Date(meta.published),
      categories: [meta.badge, ...l.data.tags],
    });
  }

  /* Mới nhất lên đầu — feed reader nào cũng mong thứ tự này */
  items.sort((a, b) => (b.pubDate?.valueOf() ?? 0) - (a.pubDate?.valueOf() ?? 0));

  return rss({
    title: `${SITE.name} — ${SITE.title}`,
    description:
      'Bilingual writing on embedded systems: FreeRTOS, embedded Linux, LVGL, ' +
      'automotive software and firmware design patterns.',
    site,
    items,
    customData: [
      '<language>en</language>',
      `<copyright>© ${new Date().getFullYear()} ${SITE.name}</copyright>`,
    ].join(''),
  });
}
