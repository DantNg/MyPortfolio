import { defineCollection, z } from 'astro:content';

const projects = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()),
    coverImage: z.string().optional(),
    status: z.enum(['completed', 'in-progress', 'archived']).default('completed'),
    githubUrl: z.string().url().optional(),
    demoUrl: z.string().url().optional(),
    featured: z.boolean().default(false),
    order: z.number().optional(),
  }),
});

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()),
    coverImage: z.string().optional(),
    draft: z.boolean().default(false),
    featured: z.boolean().default(false),
  }),
});

/**
 * Các series học tập (nằm trong tab Blog).
 * Cấu trúc thư mục: src/content/series/<series-id>/<lang>/<số>-<slug>.md
 *   ví dụ: series/lvgl/vi/03-first-widgets.md
 * Mỗi bài tồn tại ở CẢ HAI ngôn ngữ; trang bài học render cả hai rồi
 * LanguageProvider ẩn/hiện theo ngôn ngữ đang chọn (data-lang-block)
 * — chuyển ngữ tức thì, không tải lại trang.
 * Metadata của từng series (tên, mô tả, màu) nằm ở src/series.ts.
 */
const series = defineCollection({
  type: 'content',
  schema: z.object({
    lesson: z.number(),
    lang: z.enum(['en', 'vi']),
    title: z.string(),
    description: z.string(),
    duration: z.string(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { projects, blog, series };
