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
    'Embedded Software Engineer with hands-on experience in C/C++ development spanning STM32/ESP32 bare-metal firmware, FreeRTOS-based systems, and Embedded Linux middleware. Proficient in hardware protocols (UART, SPI, I2C, CAN, RS485), wireless stacks (BLE 5.0, WiFi, LoRa), and Linux IPC mechanisms (Binder, sockets, multi-threading).',

  /** Vị trí địa lý */
  location: 'Hanoi, Vietnam',

  /** Email liên hệ */
  email: 'nguyendatmc581@gmail.com',

  /** Số điện thoại */
  phone: '0969539225',

  /** URL gốc của site (đổi thành GitHub Pages / domain của bạn) */
  url: 'https://dantng.github.io',

  /**
   * Tên đăng nhập GitHub của bạn.
   * Trang /repos sẽ tự động lấy toàn bộ repo công khai
   * và đọc README của từng repo từ tài khoản này.
   */
  githubUsername: 'DantNg',
} as const;

/**
 * Liên kết mạng xã hội. Để trống ('') link nào bạn không dùng
 * thì nó sẽ tự động bị ẩn khỏi giao diện.
 */
export const SOCIALS = {
  github: 'https://github.com/DantNg',
  facebook: 'https://facebook.com/nguyen.tien.at.471119/',
  linkedin: 'https://linkedin.com/in/dantanguyen581/',
  twitter: '', // ví dụ: 'https://twitter.com/yourhandle' — để trống nếu không dùng
} as const;

/** Handle Twitter dùng cho thẻ meta (không bắt buộc) */
export const TWITTER_HANDLE = '@yourhandle';

/**
 * ============================================================
 *  ĐẾM LƯỢT XEM
 * ============================================================
 *  Site này là tĩnh (GitHub Pages) nên không có backend để tự
 *  đếm. Bộ đếm dùng dịch vụ miễn phí Abacus — không cần đăng ký,
 *  không cookie, chỉ lưu một con số cho mỗi đường dẫn.
 *
 *  LƯU Ý VỀ QUYỀN RIÊNG TƯ: mỗi lần mở trang, trình duyệt của
 *  khách sẽ gửi ĐƯỜNG DẪN trang đó tới abacus.jasoncameron.dev.
 *  Không gửi kèm thông tin cá nhân nào. Nếu bạn không muốn phụ
 *  thuộc bên thứ ba, đặt `enabled: false` là bộ đếm biến mất
 *  hoàn toàn khỏi giao diện.
 *
 *  Muốn tự chủ hoàn toàn thì thay `endpoint` bằng một Cloudflare
 *  Worker / API riêng, chỉ cần nó trả về JSON dạng {"value": số}.
 */
export const VIEWS = {
  enabled: true,

  /** Gộp số đếm theo namespace này — đổi thành domain của bạn cho khỏi trùng */
  namespace: 'dantng-github-io',

  /** `hit` để tăng rồi trả về, `get` để chỉ đọc */
  endpoint: 'https://abacus.jasoncameron.dev',

  /**
   * Chỉ tính thêm 1 lượt cho mỗi trang trong cùng một phiên trình duyệt.
   * Tắt đi thì mỗi lần F5 là +1.
   */
  onePerSession: true,
} as const;
