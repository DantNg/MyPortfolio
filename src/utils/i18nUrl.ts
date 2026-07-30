/**
 * ============================================================
 *  ĐƯỜNG DẪN THEO NGÔN NGỮ
 * ============================================================
 *  Sơ đồ URL: tiếng Anh KHÔNG có tiền tố, tiếng Việt có tiền tố `/vi`.
 *
 *      /                          →  trang chủ (blog) tiếng Anh
 *      /vi/                       →  trang chủ tiếng Việt
 *      /blog/series/rtos          →  trang series tiếng Anh
 *      /vi/blog/series/rtos       →  trang series tiếng Việt
 *
 *  Vì sao tiếng Anh không có tiền tố: mọi URL đang tồn tại (và có thể đã
 *  được Google lập chỉ mục, đã được chia sẻ) giữ nguyên. Nếu đổi sang
 *  `/en/...` thì phải 301 toàn bộ, và trang chủ `/` sẽ thành một cú chuyển
 *  hướng — điều tệ nhất có thể làm với trang mạnh nhất của tên miền.
 *
 *  CHỈ những trang thật sự có nội dung tiếng Việt mới có bản `/vi`. Bài viết
 *  lẻ, dự án, about, resume là nội dung tiếng Anh — dựng bản `/vi` cho chúng
 *  chỉ tạo ra trang gần-trùng-lặp, làm loãng chỉ mục.
 */
import type { Lang } from '../i18n';
import { url } from './url';

/**
 * Các nhánh đường dẫn có bản song ngữ thật.
 * Thêm nhánh mới ở đây là mọi thứ khác (nav, hreflang, sitemap, nút EN/VI)
 * tự theo — không phải sửa rải rác.
 */
const BILINGUAL_PREFIXES = ['/blog/series'] as const;

/** Trang chủ là trường hợp riêng: đúng '/' mới có bản song ngữ. */
export function hasTranslation(path: string): boolean {
  const p = normalize(path);
  if (p === '/') return true;
  return BILINGUAL_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + '/'));
}

/** Bỏ dấu '/' cuối (trừ chính '/') để so sánh không phụ thuộc trailing slash. */
export function normalize(path: string): string {
  const p = path.startsWith('/') ? path : '/' + path;
  return p.length > 1 ? p.replace(/\/+$/, '') : '/';
}

/**
 * Đường dẫn NỘI BỘ (chưa kèm base) của một trang ở ngôn ngữ chỉ định.
 * Trang không có bản dịch thì luôn trả về đường dẫn gốc.
 */
export function localePath(path: string, lang: Lang): string {
  const p = normalize(path);
  if (lang === 'en' || !hasTranslation(p)) return p;
  return p === '/' ? '/vi' : '/vi' + p;
}

/** Như `localePath` nhưng đã kèm base — dùng trực tiếp cho href/src. */
export function localeUrl(path: string, lang: Lang): string {
  return url(localePath(path, lang));
}

/**
 * Như `localeUrl` nhưng luôn có dấu '/' cuối.
 * Dùng cho link đổi ngôn ngữ và link trỏ sang bản dịch: nó khớp đúng dạng
 * canonical, nên crawler không phải đi qua một nhịp chuyển hướng.
 */
export function localeHref(path: string, lang: Lang): string {
  const u = localeUrl(path, lang);
  return u.endsWith('/') ? u : u + '/';
}

/**
 * Bỏ tiền tố `/vi` khỏi một đường dẫn để lấy lại đường dẫn gốc (tiếng Anh).
 * Dùng khi cần dựng thẻ hreflang từ chính trang đang render.
 */
export function stripLocale(path: string): { path: string; lang: Lang } {
  const p = normalize(path);
  if (p === '/vi') return { path: '/', lang: 'vi' };
  if (p.startsWith('/vi/')) return { path: p.slice(3), lang: 'vi' };
  return { path: p, lang: 'en' };
}

/**
 * Bộ thẻ hreflang cho một trang.
 *
 * Trả về mảng rỗng nếu trang không có bản dịch — khai hreflang cho trang chỉ
 * có một ngôn ngữ là khai báo sai, và Google Search Console sẽ báo lỗi
 * "no return tag".
 *
 * `x-default` trỏ về bản tiếng Anh: đó là trang cho người dùng mà ta không
 * biết ngôn ngữ ưu tiên của họ.
 */
export function alternatesFor(path: string): { hreflang: string; path: string }[] {
  const p = normalize(path);
  if (!hasTranslation(p)) return [];
  return [
    { hreflang: 'en', path: localePath(p, 'en') },
    { hreflang: 'vi', path: localePath(p, 'vi') },
    { hreflang: 'x-default', path: localePath(p, 'en') },
  ];
}
