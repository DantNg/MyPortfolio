/**
 * ============================================================
 *  SONG NGỮ (i18n) — TỪ ĐIỂN DỊCH ANH / VIỆT
 * ============================================================
 *  Mỗi chuỗi có 1 "key". Component render bản tiếng Anh (mặc định)
 *  kèm thuộc tính data-i18n="key". Khi người dùng gạt nút chuyển
 *  ngôn ngữ, một đoạn script nhỏ sẽ thay nội dung theo từ điển này
 *  — KHÔNG tải lại trang. Lựa chọn được lưu trong localStorage.
 *
 *  Muốn thêm chuỗi dịch mới: thêm cùng 1 key vào cả `en` và `vi`,
 *  rồi gắn data-i18n="key" vào phần tử tương ứng trong .astro.
 */

export const defaultLang = 'en' as const;

export const languages = {
  en: 'English',
  vi: 'Tiếng Việt',
} as const;

export type Lang = keyof typeof languages;

type Dict = Record<string, string>;

export const ui: Record<Lang, Dict> = {
  en: {
    // ---- Navbar ----
    'nav.about': 'About',
    'nav.projects': 'Projects',
    'nav.repos': 'Repos',
    'nav.blog': 'Blog',
    'nav.resume': 'Resume',
    'nav.contact': 'Contact',

    // ---- Hero ----
    'hero.badge': 'Available for new opportunities',
    'hero.cta.projects': 'View Projects',
    'hero.cta.articles': 'Read Articles',
    'hero.cta.contact': 'Contact Me',
    'hero.stat.experience': 'Years Experience',
    'hero.stat.projects': 'Projects Shipped',
    'hero.stat.platforms': 'MCU Platforms',
    'hero.stat.oss': 'Open Source Libs',

    // ---- Skills ----
    'skills.eyebrow': 'Expertise',
    'skills.heading': 'Technical Skills',
    'skills.subheading': 'Five years of hands-on experience across the full embedded stack — from silicon bring-up to cloud-connected firmware.',
    'skills.cat.embedded': 'Embedded Systems',
    'skills.cat.connectivity': 'Connectivity',
    'skills.cat.linux': 'Linux & Software',
    'skills.cat.drone': 'Tools & Platforms',

    // ---- LoRa Mesh / Drone ----
    'mesh.eyebrow': 'Live Systems',
    'mesh.heading': 'Explore My Work as a LoRa Mesh',
    'mesh.subheading': 'Every node is a real project. Packets multi-hop from edge devices to the gateway — hover a node to inspect it, click to open the project.',
    'mesh.legend.gateway': 'Gateway (hub)',
    'mesh.legend.node': 'Wired Project',
    'mesh.legend.drone': 'Wireless Project',
    'mesh.legend.packet': 'Data Packet',
    'mesh.hint': 'Hover a node to inspect a project',

    // ---- Featured Projects ----
    'projects.eyebrow': 'Work',
    'projects.heading': 'Featured Projects',
    'projects.subheading': "A selection of embedded systems projects I'm proud of.",
    'projects.viewAll': 'View all projects',

    // ---- Latest Articles ----
    'blog.eyebrow': 'Writing',
    'blog.heading': 'Latest Articles',
    'blog.subheading': "Deep dives into embedded systems, firmware architecture, and the lessons I've learned the hard way.",
    'blog.viewAll': 'View all articles',

    // ---- Timeline ----
    'timeline.eyebrow': 'Career',
    'timeline.heading': 'Professional Timeline',
    'timeline.subheading': 'A journey through embedded systems, from student projects to production firmware.',

    // ---- Contact ----
    'contact.eyebrow': 'Contact',
    'contact.heading': "Let's Work Together",
    'contact.subheading': 'Open to new projects, collaborations, and full-time roles. I typically respond within 24 hours.',
    'contact.getInTouch': 'Get in touch',
    'contact.available.title': 'Available for Work',
    'contact.available.body': 'Currently open to full-time embedded engineer roles and consulting projects. Open to remote.',
    'contact.form.title': 'Send a message',
    'contact.form.name': 'Name',
    'contact.form.email': 'Email',
    'contact.form.subject': 'Subject',
    'contact.form.message': 'Message',
    'contact.form.send': 'Send Message',
    'contact.form.namePh': 'John Doe',
    'contact.form.emailPh': 'john@example.com',
    'contact.form.subjectPh': 'Project inquiry...',
    'contact.form.messagePh': 'Tell me about your project...',

    // ---- Footer ----
    'footer.tagline': 'building reliable firmware for connected devices, drones, and industrial systems.',
    'footer.nav': 'Navigation',
    'footer.connect': 'Connect',
    'footer.built': 'Built with',
    'footer.motto': '</> with passion for embedded systems',

    // ---- About page ----
    'about.eyebrow': 'About',
    'about.heading': 'Building at the boundary of hardware and software',
    'about.lead': "I'm an Embedded Software Engineer working on automotive middleware at LG Electronics R&D Vietnam, with a background spanning STM32/ESP32 firmware, FreeRTOS, and Embedded Linux.",
    'about.story.title': 'My Story',
    'about.story.p1': 'My journey started in Control & Automation Engineering at VNU – University of Engineering & Technology, where I discovered a passion for working close to the hardware — FPGA, sensors, and real-time systems. An internship at the Viettel Aerospace Institute, building FPGA + IMU systems with a Qt control application, set me firmly on the embedded path.',
    'about.story.p2': 'At FPT Software I developed middleware APIs bridging applications and hardware, wrote automated tests, and hunted down memory issues. Today, at LG Electronics R&D Vietnam, I build C++ middleware for automotive platforms — IPC over Android Binder, binary database services, and backup/recovery mechanisms for reliable persistent storage.',
    'about.story.p3': 'Outside of work I build personal embedded projects — STM32 Modbus sensors, a FreeRTOS coffee-machine controller, and a coin-size BLE IMU logger — and I am pursuing a Master of Mechatronics to deepen my control and robotics expertise.',
    'about.philosophy.title': 'Philosophy',
    'about.phil.1.t': 'Hardware-aware code',
    'about.phil.1.d': "Good firmware starts with understanding the silicon. I read datasheets, trace signal timings, and never trust a peripheral until I've verified it with a logic analyzer.",
    'about.phil.2.t': 'Determinism first',
    'about.phil.2.d': 'In real-time systems, a correct result at the wrong time is a wrong result. I design around hard timing budgets from day one.',
    'about.phil.3.t': 'Power is a resource',
    'about.phil.3.d': 'On battery-powered devices, every clock cycle costs electrons. I profile power before writing the first line of application code.',
    'about.phil.4.t': 'Test at every layer',
    'about.phil.4.d': "Unit tests for pure logic, integration tests with hardware-in-the-loop, and system tests with protocol analyzers. Bugs found early are bugs that don't ship.",
    'about.tools.title': 'Tools & Technologies',
    'about.glance.title': 'At a glance',
    'about.glance.experience': 'Experience',
    'about.glance.projects': 'Projects shipped',
    'about.glance.platforms': 'MCU platforms',
    'about.glance.languages': 'Languages',
    'about.glance.location': 'Location',
    'about.glance.status': 'Status',
    'about.glance.statusValue': 'Open to work',
    'about.glance.experienceValue': '2+ years',
    'about.downloadCv': 'Download Resume',

    // ---- Resume page ----
    'resume.download': 'Download PDF',
    'resume.summary': 'Summary',
    'resume.summaryBody': 'Embedded Software Engineer with hands-on experience in C/C++ development spanning STM32/ESP32 bare-metal firmware, FreeRTOS-based systems, and Embedded Linux middleware. Proficient in hardware protocols (UART, SPI, I2C, CAN, RS485), wireless stacks (BLE 5.0, WiFi, LoRa), and Linux IPC mechanisms (Binder, sockets, multi-threading).',
    'resume.experience': 'Experience',
    'resume.education': 'Education',
    'resume.skills': 'Technical Skills',
    'resume.languages': 'Languages',

    // ---- Common ----
    'common.backProjects': 'Back to all projects',
    'common.backArticles': 'Back to all articles',
    'lang.toggle': 'Switch language',
  },

  vi: {
    // ---- Navbar ----
    'nav.about': 'Giới thiệu',
    'nav.projects': 'Dự án',
    'nav.repos': 'Mã nguồn',
    'nav.blog': 'Bài viết',
    'nav.resume': 'Hồ sơ',
    'nav.contact': 'Liên hệ',

    // ---- Hero ----
    'hero.badge': 'Sẵn sàng cho cơ hội mới',
    'hero.cta.projects': 'Xem dự án',
    'hero.cta.articles': 'Đọc bài viết',
    'hero.cta.contact': 'Liên hệ',
    'hero.stat.experience': 'Năm kinh nghiệm',
    'hero.stat.projects': 'Dự án đã hoàn thành',
    'hero.stat.platforms': 'Nền tảng MCU',
    'hero.stat.oss': 'Thư viện mã nguồn mở',

    // ---- Skills ----
    'skills.eyebrow': 'Chuyên môn',
    'skills.heading': 'Kỹ năng kỹ thuật',
    'skills.subheading': 'Năm năm kinh nghiệm thực chiến trên toàn bộ hệ thống nhúng — từ bring-up phần cứng đến firmware kết nối đám mây.',
    'skills.cat.embedded': 'Hệ thống nhúng',
    'skills.cat.connectivity': 'Kết nối',
    'skills.cat.linux': 'Linux & Phần mềm',
    'skills.cat.drone': 'Công cụ & Nền tảng',

    // ---- LoRa Mesh / Drone ----
    'mesh.eyebrow': 'Hệ thống trực tiếp',
    'mesh.heading': 'Khám phá dự án dưới dạng LoRa Mesh',
    'mesh.subheading': 'Mỗi node là một dự án thật. Gói tin nhảy đa chặng từ thiết bị biên về gateway — di chuột để xem, bấm để mở dự án.',
    'mesh.legend.gateway': 'Gateway (hub)',
    'mesh.legend.node': 'Dự án có dây',
    'mesh.legend.drone': 'Dự án không dây',
    'mesh.legend.packet': 'Gói dữ liệu',
    'mesh.hint': 'Di chuột vào node để xem dự án',

    // ---- Featured Projects ----
    'projects.eyebrow': 'Công việc',
    'projects.heading': 'Dự án tiêu biểu',
    'projects.subheading': 'Một số dự án hệ thống nhúng mà tôi tự hào.',
    'projects.viewAll': 'Xem tất cả dự án',

    // ---- Latest Articles ----
    'blog.eyebrow': 'Viết lách',
    'blog.heading': 'Bài viết mới nhất',
    'blog.subheading': 'Đào sâu về hệ thống nhúng, kiến trúc firmware và những bài học rút ra từ thực tế.',
    'blog.viewAll': 'Xem tất cả bài viết',

    // ---- Timeline ----
    'timeline.eyebrow': 'Sự nghiệp',
    'timeline.heading': 'Hành trình nghề nghiệp',
    'timeline.subheading': 'Hành trình với hệ thống nhúng, từ dự án sinh viên đến firmware thương mại.',

    // ---- Contact ----
    'contact.eyebrow': 'Liên hệ',
    'contact.heading': 'Cùng hợp tác nhé',
    'contact.subheading': 'Sẵn sàng cho dự án mới, hợp tác và vị trí toàn thời gian. Tôi thường phản hồi trong vòng 24 giờ.',
    'contact.getInTouch': 'Kết nối',
    'contact.available.title': 'Sẵn sàng nhận việc',
    'contact.available.body': 'Hiện đang tìm vị trí kỹ sư nhúng toàn thời gian và các dự án tư vấn. Chấp nhận làm từ xa.',
    'contact.form.title': 'Gửi tin nhắn',
    'contact.form.name': 'Họ tên',
    'contact.form.email': 'Email',
    'contact.form.subject': 'Tiêu đề',
    'contact.form.message': 'Nội dung',
    'contact.form.send': 'Gửi tin nhắn',
    'contact.form.namePh': 'Nguyễn Văn A',
    'contact.form.emailPh': 'email@vidu.com',
    'contact.form.subjectPh': 'Trao đổi về dự án...',
    'contact.form.messagePh': 'Hãy cho tôi biết về dự án của bạn...',

    // ---- Footer ----
    'footer.tagline': 'xây dựng firmware tin cậy cho thiết bị kết nối, drone và hệ thống công nghiệp.',
    'footer.nav': 'Điều hướng',
    'footer.connect': 'Kết nối',
    'footer.built': 'Xây dựng với',
    'footer.motto': '</> với đam mê hệ thống nhúng',

    // ---- About page ----
    'about.eyebrow': 'Giới thiệu',
    'about.heading': 'Xây dựng ở ranh giới giữa phần cứng và phần mềm',
    'about.lead': 'Tôi là Kỹ sư Phần mềm Nhúng đang phát triển middleware ô tô tại LG Electronics R&D Việt Nam, với nền tảng trải dài từ firmware STM32/ESP32, FreeRTOS đến Embedded Linux.',
    'about.story.title': 'Câu chuyện của tôi',
    'about.story.p1': 'Hành trình của tôi bắt đầu từ ngành Kỹ thuật Điều khiển & Tự động hóa tại Trường Đại học Công nghệ – ĐHQGHN, nơi tôi tìm thấy đam mê làm việc sát phần cứng — FPGA, cảm biến và hệ thống thời gian thực. Kỳ thực tập tại Viện Hàng không Vũ trụ Viettel, xây dựng hệ FPGA + IMU cùng ứng dụng điều khiển Qt, đã đưa tôi đến với con đường nhúng.',
    'about.story.p2': 'Tại FPT Software, tôi phát triển các API middleware kết nối ứng dụng với phần cứng, viết kiểm thử tự động và xử lý các lỗi bộ nhớ. Hiện tại, tại LG Electronics R&D Việt Nam, tôi xây dựng middleware C++ cho nền tảng ô tô — IPC qua Android Binder, dịch vụ cơ sở dữ liệu nhị phân, cùng cơ chế sao lưu/phục hồi để lưu trữ dữ liệu tin cậy.',
    'about.story.p3': 'Ngoài công việc, tôi tự làm các dự án nhúng cá nhân — cảm biến Modbus STM32, bộ điều khiển máy pha cà phê dùng FreeRTOS, và thiết bị ghi IMU BLE cỡ đồng xu — đồng thời đang học Thạc sĩ Cơ điện tử để nâng cao chuyên môn điều khiển và robotics.',
    'about.philosophy.title': 'Triết lý làm việc',
    'about.phil.1.t': 'Code hiểu phần cứng',
    'about.phil.1.d': 'Firmware tốt bắt đầu từ việc hiểu con chip. Tôi đọc datasheet, soi timing tín hiệu, và không tin một ngoại vi nào cho đến khi đã kiểm chứng bằng máy phân tích logic.',
    'about.phil.2.t': 'Tính tất định trên hết',
    'about.phil.2.d': 'Trong hệ thống thời gian thực, kết quả đúng nhưng sai thời điểm vẫn là kết quả sai. Tôi thiết kế quanh ngân sách thời gian chặt chẽ ngay từ đầu.',
    'about.phil.3.t': 'Năng lượng là tài nguyên',
    'about.phil.3.d': 'Trên thiết bị chạy pin, mỗi chu kỳ clock đều tốn electron. Tôi đo công suất trước khi viết dòng code ứng dụng đầu tiên.',
    'about.phil.4.t': 'Kiểm thử ở mọi tầng',
    'about.phil.4.d': 'Unit test cho logic thuần, integration test với hardware-in-the-loop, và system test với máy phân tích giao thức. Lỗi tìm ra sớm là lỗi không bị phát hành.',
    'about.tools.title': 'Công cụ & Công nghệ',
    'about.glance.title': 'Tổng quan',
    'about.glance.experience': 'Kinh nghiệm',
    'about.glance.projects': 'Dự án đã làm',
    'about.glance.platforms': 'Nền tảng MCU',
    'about.glance.languages': 'Ngôn ngữ',
    'about.glance.location': 'Vị trí',
    'about.glance.status': 'Trạng thái',
    'about.glance.statusValue': 'Đang tìm việc',
    'about.glance.experienceValue': 'Hơn 2 năm',
    'about.downloadCv': 'Tải hồ sơ',

    // ---- Resume page ----
    'resume.download': 'Tải PDF',
    'resume.summary': 'Tóm tắt',
    'resume.summaryBody': 'Kỹ sư Phần mềm Nhúng với nhiều năm kinh nghiệm phát triển C/C++ trải dài từ firmware bare-metal STM32/ESP32, hệ thống dùng FreeRTOS, đến middleware trên Embedded Linux. Thành thạo các giao thức phần cứng (UART, SPI, I2C, CAN, RS485), ngăn xếp không dây (BLE 5.0, WiFi, LoRa) và cơ chế IPC trên Linux (Binder, socket, đa luồng).',
    'resume.experience': 'Kinh nghiệm làm việc',
    'resume.education': 'Học vấn',
    'resume.skills': 'Kỹ năng kỹ thuật',
    'resume.languages': 'Ngôn ngữ',

    // ---- Common ----
    'common.backProjects': 'Về tất cả dự án',
    'common.backArticles': 'Về tất cả bài viết',
    'lang.toggle': 'Chuyển ngôn ngữ',
  },
};

/** Lấy chuỗi tiếng Anh (bản render mặc định phía server). */
export function t(key: string): string {
  return ui[defaultLang][key] ?? key;
}
