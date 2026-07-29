/**
 * ============================================================
 *  DANH MỤC SERIES HỌC TẬP (hiển thị trong tab Blog)
 * ============================================================
 *  Mỗi series là một thư mục trong src/content/series/<id>/
 *  với hai thư mục con `en/` và `vi/` chứa các bài học.
 *
 *  Thêm series mới:
 *    1. tạo src/content/series/<id>/{en,vi}/01-....md
 *    2. thêm một mục vào SERIES bên dưới
 *  Không cần sửa gì thêm — trang /blog và /blog/series/<id> tự cập nhật.
 */

export interface SeriesMeta {
  /** khớp với tên thư mục trong src/content/series/ */
  id: string;
  /** thứ tự hiển thị, nhỏ trước */
  order: number;
  /** nhãn ngắn hiện trên thẻ (không dịch) */
  badge: string;
  title: { en: string; vi: string };
  /** một câu, dùng cho thẻ series */
  tagline: { en: string; vi: string };
  /** đoạn giới thiệu ở đầu trang series */
  intro: { en: string; vi: string };
  audience: { en: string; vi: string };
  requirements: { en: string; vi: string };
  /** path của icon Heroicons (24 outline) */
  iconPath: string;
}

export const SERIES: SeriesMeta[] = [
  {
    id: 'lvgl',
    order: 1,
    badge: 'LVGL',
    iconPath:
      'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z',
    title: {
      en: 'LVGL for Beginners',
      vi: 'LVGL cho người mới bắt đầu',
    },
    tagline: {
      en: 'Build a real embedded GUI, from the retained-mode model to a running sensor dashboard.',
      vi: 'Dựng một giao diện nhúng thật, từ mô hình retained-mode tới dashboard cảm biến chạy được.',
    },
    intro: {
      en: 'Eight lessons that take you from "what is a retained-mode GUI" to a working sensor dashboard on real hardware. Every lesson has runnable code and diagrams — and reads in English or Vietnamese with one click.',
      vi: 'Tám bài đưa bạn từ câu hỏi "GUI retained-mode là gì" tới một dashboard cảm biến chạy trên phần cứng thật. Mỗi bài đều có code chạy được và hình minh hoạ — đọc bằng tiếng Việt hay tiếng Anh chỉ với một cú bấm.',
    },
    audience: {
      en: 'Embedded developers comfortable with C who have never built a GUI, and anyone who has copied an LVGL example and wants to understand what it actually does.',
      vi: 'Lập trình viên nhúng đã quen C nhưng chưa từng làm giao diện, và bất kỳ ai từng copy một ví dụ LVGL rồi muốn hiểu nó thực sự làm gì.',
    },
    requirements: {
      en: 'A C compiler and about an hour. Hardware is optional — lessons 3 to 8 run in the PC simulator set up in lesson 2.',
      vi: 'Một trình biên dịch C và khoảng một giờ. Phần cứng là tuỳ chọn — bài 3 đến 8 chạy được trên simulator PC dựng ở bài 2.',
    },
  },
  {
    id: 'linux',
    order: 2,
    badge: 'Linux',
    iconPath:
      'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    title: {
      en: 'Linux for Embedded Developers',
      vi: 'Linux cho lập trình viên nhúng',
    },
    tagline: {
      en: 'From your first shell prompt to cross-compiling and talking to hardware from user space.',
      vi: 'Từ dấu nhắc shell đầu tiên tới cross-compile và điều khiển phần cứng từ user space.',
    },
    intro: {
      en: 'Eight lessons that build a working Linux foundation for firmware people: the kernel/user-space split, the commands you will actually type every day, permissions, processes, scripting, remote work with SSH and systemd, debugging with the tools that ship on every box, and finally cross-compiling and driving GPIO/I2C on a real board.',
      vi: 'Tám bài xây nền Linux thực dụng cho dân firmware: ranh giới kernel/user space, những lệnh bạn thật sự gõ hằng ngày, phân quyền, tiến trình, viết script, làm việc từ xa với SSH và systemd, gỡ lỗi bằng công cụ có sẵn trên mọi máy, và cuối cùng là cross-compile cùng điều khiển GPIO/I2C trên board thật.',
    },
    audience: {
      en: 'Developers who have used Windows their whole career and now face a Linux build server, a Yocto image, or a Raspberry Pi — plus anyone who copies shell commands without knowing what they do.',
      vi: 'Người đã quen Windows cả sự nghiệp và giờ phải đối mặt với máy build Linux, một image Yocto hay một Raspberry Pi — và bất kỳ ai vẫn copy lệnh shell mà chưa biết nó làm gì.',
    },
    requirements: {
      en: 'Any Linux you can type into: WSL2 on Windows, a VM, or a Raspberry Pi. Lessons 1 to 7 need nothing else; lesson 8 is better with a board.',
      vi: 'Bất kỳ bản Linux nào gõ lệnh được: WSL2 trên Windows, một máy ảo, hoặc Raspberry Pi. Bài 1 đến 7 không cần gì thêm; bài 8 sẽ hay hơn nếu có board.',
    },
  },
];

export function getSeries(id: string): SeriesMeta | undefined {
  return SERIES.find((s) => s.id === id);
}
