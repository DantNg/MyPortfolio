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
 * Series học LVGL — mỗi bài có 2 file: `<slug>.en.md` và `<slug>.vi.md`.
 * Trang bài học render CẢ HAI, rồi LanguageProvider ẩn/hiện theo ngôn ngữ
 * đang chọn (data-lang-block) — chuyển ngữ tức thì, không tải lại trang.
 */
const lvgl = defineCollection({
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

export const collections = { projects, blog, lvgl };
