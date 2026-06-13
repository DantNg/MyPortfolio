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
    'skills.cat.drone': 'Drone & Robotics',

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
    'about.lead': "I'm an Embedded Software Engineer with 5+ years of experience shipping firmware for connected devices, autonomous systems, and industrial IoT products.",
    'about.story.title': 'My Story',
    'about.story.p1': 'I fell in love with embedded systems during my third year of university when I stayed up for 48 hours debugging an I2C communication issue between an STM32 and an MPU-6050 IMU. When it finally worked — when the accelerometer data started streaming in cleanly and the LED blinked exactly on time — I knew this was what I wanted to do.',
    'about.story.p2': "Since then I've worked across the full spectrum: bare-metal Cortex-M, RTOS-based IoT firmware, BLE and LoRaWAN stacks, and flight controller software for autonomous drones. I care about determinism, power efficiency, and code that will still be maintainable in five years.",
    'about.story.p3': 'Outside of work, I contribute to open-source embedded projects, write about what I learn on this blog, and experiment with small drone builds.',
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
    'about.glance.experienceValue': '5+ years',
    'about.downloadCv': 'Download Resume',

    // ---- Resume page ----
    'resume.download': 'Download PDF',
    'resume.summary': 'Summary',
    'resume.summaryBody': 'Embedded Software Engineer with 5+ years of experience designing, implementing, and shipping firmware for constrained devices. Deep expertise in RTOS-based concurrent systems (FreeRTOS, Zephyr), wireless connectivity stacks (BLE Mesh, LoRaWAN, WiFi), and safety-critical real-time applications.',
    'resume.experience': 'Experience',
    'resume.education': 'Education',
    'resume.skills': 'Technical Skills',
    'resume.certs': 'Certifications & Achievements',
    'resume.edu.degree': 'B.Sc. Electrical & Computer Engineering',
    'resume.edu.school': 'University of Technology',
    'resume.edu.desc': 'Graduated with honors. Thesis: "Real-Time Sensor Fusion for UAV Attitude Estimation Using Extended Kalman Filter."',

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
    'skills.cat.drone': 'Drone & Robotics',

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
    'about.lead': 'Tôi là Kỹ sư Phần mềm Nhúng với hơn 5 năm kinh nghiệm phát triển firmware cho thiết bị kết nối, hệ thống tự hành và sản phẩm IoT công nghiệp.',
    'about.story.title': 'Câu chuyện của tôi',
    'about.story.p1': 'Tôi đem lòng yêu hệ thống nhúng vào năm ba đại học khi thức trắng 48 giờ để gỡ lỗi giao tiếp I2C giữa STM32 và cảm biến IMU MPU-6050. Khi nó cuối cùng cũng chạy — dữ liệu gia tốc kế chảy về mượt mà và đèn LED nhấp nháy đúng nhịp — tôi biết đây chính là điều mình muốn làm.',
    'about.story.p2': 'Từ đó tôi làm việc trên toàn bộ phổ rộng: bare-metal Cortex-M, firmware IoT dùng RTOS, ngăn xếp BLE và LoRaWAN, và phần mềm điều khiển bay cho drone tự hành. Tôi coi trọng tính tất định, hiệu quả năng lượng và mã nguồn vẫn dễ bảo trì sau năm năm.',
    'about.story.p3': 'Ngoài công việc, tôi đóng góp cho các dự án nhúng mã nguồn mở, viết lại những gì học được trên blog này, và thử nghiệm chế tạo drone nhỏ.',
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
    'about.glance.experienceValue': 'Hơn 5 năm',
    'about.downloadCv': 'Tải hồ sơ',

    // ---- Resume page ----
    'resume.download': 'Tải PDF',
    'resume.summary': 'Tóm tắt',
    'resume.summaryBody': 'Kỹ sư Phần mềm Nhúng với hơn 5 năm kinh nghiệm thiết kế, triển khai và phát hành firmware cho thiết bị tài nguyên hạn chế. Chuyên sâu về hệ thống đa luồng dùng RTOS (FreeRTOS, Zephyr), ngăn xếp kết nối không dây (BLE Mesh, LoRaWAN, WiFi) và ứng dụng thời gian thực an toàn quan trọng.',
    'resume.experience': 'Kinh nghiệm làm việc',
    'resume.education': 'Học vấn',
    'resume.skills': 'Kỹ năng kỹ thuật',
    'resume.certs': 'Chứng chỉ & Thành tích',
    'resume.edu.degree': 'Cử nhân Kỹ thuật Điện & Máy tính',
    'resume.edu.school': 'Đại học Bách Khoa',
    'resume.edu.desc': 'Tốt nghiệp loại giỏi. Luận văn: "Hợp nhất cảm biến thời gian thực để ước lượng tư thế UAV bằng bộ lọc Kalman mở rộng."',

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
