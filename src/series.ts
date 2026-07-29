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

SERIES.push(
  {
    id: 'rtos',
    order: 3,
    badge: 'RTOS',
    iconPath:
      'M13 10V3L4 14h7v7l9-11h-7z',
    title: {
      en: 'RTOS Fundamentals with FreeRTOS',
      vi: 'Nền tảng RTOS với FreeRTOS',
    },
    tagline: {
      en: 'Tasks, queues, semaphores and interrupts — and the timing bugs that only show up in the field.',
      vi: 'Task, queue, semaphore và ngắt — cùng những lỗi định thời chỉ lộ ra khi sản phẩm đã ra thực địa.',
    },
    intro: {
      en: 'Six lessons on doing real-time right: when a superloop stops being enough, how the scheduler actually decides, why blocking beats polling, the synchronization primitives and the classic bugs each one causes, safe interrupt handling, and how to size stacks and find the overflow before your customer does.',
      vi: 'Sáu bài về làm thời gian thực cho đúng: khi nào superloop hết đủ dùng, bộ lập lịch thực sự quyết định thế nào, vì sao chặn (blocking) hơn hỏi vòng (polling), các cơ chế đồng bộ và lỗi kinh điển đi kèm từng cái, xử lý ngắt an toàn, và cách tính stack rồi tìm ra lỗi tràn trước khi khách hàng tìm ra.',
    },
    audience: {
      en: 'Firmware developers who have written superloops and are about to add an RTOS — or who inherited one and want to stop being surprised by it.',
      vi: 'Lập trình viên firmware đã viết superloop và sắp đưa RTOS vào — hoặc đang thừa kế một dự án có RTOS và muốn thôi bị nó làm cho bất ngờ.',
    },
    requirements: {
      en: 'C and some MCU experience. Examples use FreeRTOS on STM32 or ESP32, but the concepts carry to Zephyr, ThreadX and RT-Thread unchanged.',
      vi: 'Biết C và có chút kinh nghiệm MCU. Ví dụ dùng FreeRTOS trên STM32 hoặc ESP32, nhưng khái niệm chuyển sang Zephyr, ThreadX hay RT-Thread vẫn nguyên vẹn.',
    },
  },
  {
    id: 'automotive',
    order: 4,
    badge: 'Automotive',
    iconPath:
      'M8 17h8m-9-4h10a2 2 0 002-2V9a2 2 0 00-2-2h-1l-1.6-2.4A2 2 0 0012.7 4h-3.4a2 2 0 00-1.7.9L6 7H5a2 2 0 00-2 2v2a2 2 0 002 2zm1 4a1 1 0 11-2 0 1 1 0 012 0zm10 0a1 1 0 11-2 0 1 1 0 012 0z',
    title: {
      en: 'Automotive Software for Embedded Engineers',
      vi: 'Phần mềm ô tô cho kỹ sư nhúng',
    },
    tagline: {
      en: 'ECUs, CAN, UDS diagnostics, AUTOSAR and functional safety — the vocabulary and the mechanics.',
      vi: 'ECU, CAN, chẩn đoán UDS, AUTOSAR và an toàn chức năng — cả từ vựng lẫn cách vận hành.',
    },
    intro: {
      en: 'Six lessons mapping the automotive software world for someone arriving from general embedded work: how a car is organized into ECUs and why that is changing, CAN and CAN FD down to the bit, UDS diagnostics and DTCs, AUTOSAR Classic layer by layer, the Adaptive/service-oriented side with SOME/IP, and what ISO 26262 and ASIL actually demand of your code.',
      vi: 'Sáu bài vẽ lại bản đồ phần mềm ô tô cho người từ mảng nhúng chung bước sang: xe được tổ chức thành các ECU ra sao và vì sao điều đó đang thay đổi, CAN và CAN FD tới từng bit, chẩn đoán UDS và mã lỗi DTC, AUTOSAR Classic theo từng tầng, phía Adaptive hướng dịch vụ với SOME/IP, và ISO 26262 cùng ASIL thực sự đòi hỏi gì ở code của bạn.',
    },
    audience: {
      en: 'Embedded engineers moving into automotive, and anyone at a Tier 1 or OEM who touches code but has never been given the map.',
      vi: 'Kỹ sư nhúng chuyển sang mảng ô tô, và bất kỳ ai ở Tier 1 hay OEM đang chạm vào code nhưng chưa từng được đưa cho tấm bản đồ tổng thể.',
    },
    requirements: {
      en: 'C or C++ and general embedded background. No car required — a USB-CAN adapter and can-utils on Linux cover the hands-on parts.',
      vi: 'Biết C hoặc C++ và có nền nhúng. Không cần ô tô — một adapter USB-CAN cùng can-utils trên Linux là đủ cho phần thực hành.',
    },
  },
  {
    id: 'design-patterns',
    order: 5,
    badge: 'Patterns',
    iconPath:
      'M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z',
    title: {
      en: 'Design Patterns for Embedded C and C++',
      vi: 'Design Pattern cho C và C++ nhúng',
    },
    tagline: {
      en: 'The handful of structures that keep firmware testable when it grows past ten thousand lines.',
      vi: 'Vài cấu trúc ít ỏi giữ cho firmware còn kiểm thử được khi nó vượt qua mười nghìn dòng.',
    },
    intro: {
      en: 'Six lessons on structure, written for constrained targets rather than enterprise servers: SOLID translated into firmware terms, state machines done four different ways with the trade-offs, interfaces and dependency injection in plain C, the behavioral patterns that decouple ISRs from logic, what C++ buys you at zero runtime cost, and the anti-patterns that make firmware impossible to test.',
      vi: 'Sáu bài về cấu trúc code, viết cho thiết bị hạn chế tài nguyên chứ không phải server doanh nghiệp: SOLID dịch sang ngôn ngữ firmware, máy trạng thái làm theo bốn cách kèm đánh đổi, interface và dependency injection bằng C thuần, các pattern hành vi tách ISR khỏi logic, C++ cho bạn thêm gì mà không tốn runtime, và những anti-pattern khiến firmware không thể kiểm thử.',
    },
    audience: {
      en: 'Firmware developers whose files have grown past a thousand lines, and anyone who wants to unit-test code that touches registers.',
      vi: 'Lập trình viên firmware có những file đã vượt nghìn dòng, và bất kỳ ai muốn unit-test đoạn code có đụng tới thanh ghi.',
    },
    requirements: {
      en: 'Solid C. The C++ lesson assumes no more than classes and templates. All examples compile on a host, so you can run them without hardware.',
      vi: 'Nắm chắc C. Bài về C++ chỉ giả định bạn biết class và template. Mọi ví dụ đều biên dịch được trên máy tính, chạy thử không cần phần cứng.',
    },
  },
);

export function getSeries(id: string): SeriesMeta | undefined {
  return SERIES.find((s) => s.id === id);
}
