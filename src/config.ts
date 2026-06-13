/**
 * ============================================================
 *  THÔNG TIN CÁ NHÂN — CHỈ CẦN SỬA DUY NHẤT FILE NÀY
 * ============================================================
 *  Mọi thông tin tên, email, mạng xã hội, GitHub... đều lấy
 *  từ đây. Sửa ở đây là toàn bộ website tự cập nhật theo.
 */

export const SITE = {
  /** Tên hiển thị của bạn */
  name: 'Dat Nguyen',

  /** Chữ viết tắt hiển thị trên logo (1–2 ký tự) */
  initials: 'DN',

  /** Chức danh nghề nghiệp */
  title: 'Embedded Software Engineer',

  /** Giới thiệu ngắn (hiển thị ở Hero trang chủ) */
  intro:
    'I design and ship firmware for constrained devices — from bare-metal STM32 to Zephyr-powered BLE Mesh networks and autonomous drone platforms. I care deeply about real-time reliability, power efficiency, and clean embedded architecture.',

  /** Vị trí địa lý */
  location: 'Hanoi, Vietnam',

  /** Email liên hệ */
  email: 'nguyendatmc581@gmail.com',

  /** URL gốc của site (đổi thành GitHub Pages / domain của bạn) */
  url: 'https://dantng.github.io',

  /**
   * Tên đăng nhập GitHub của bạn.
   * Trang /repos sẽ tự động lấy toàn bộ repo công khai
   * và đọc README của từng repo từ tài khoản này.
   */
  githubUsername: 'dantng',
} as const;

/**
 * Liên kết mạng xã hội. Để trống ('') link nào bạn không dùng
 * thì nó sẽ tự động bị ẩn khỏi giao diện.
 */
export const SOCIALS = {
  github: 'https://github.com/dantng',
  facebook: 'https://facebook.com/nguyen.tien.at.471119/',
  linkedin: 'https://linkedin.com/in/dantnguyen581/',
  twitter: '', // ví dụ: 'https://twitter.com/yourhandle' — để trống nếu không dùng
} as const;

/** Handle Twitter dùng cho thẻ meta (không bắt buộc) */
export const TWITTER_HANDLE = '@yourhandle';
