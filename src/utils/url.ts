/**
 * Tạo đường dẫn nội bộ có kèm `base` (vd: /MyPortfolio) để chạy đúng
 * trên GitHub Pages project site. Dùng cho MỌI link nội bộ & asset tĩnh.
 *
 *   url('/about')        -> '/MyPortfolio/about'   (khi base = '/MyPortfolio')
 *   url('/about')        -> '/about'               (khi base = '/')
 *   url('/')             -> '/MyPortfolio/'  hoặc  '/'
 */
const BASE = import.meta.env.BASE_URL; // Astro: '/MyPortfolio/' hoặc '/'

export function url(path = '/'): string {
  const base = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE; // bỏ '/' cuối
  const p = path.startsWith('/') ? path : '/' + path;
  const result = base + p;
  return result === '' ? '/' : result;
}
