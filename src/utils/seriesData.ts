import { getCollection, type CollectionEntry } from 'astro:content';
import { SERIES } from '../series';

export type SeriesEntry = CollectionEntry<'series'>;

export interface LessonGroup {
  /** số thứ tự bài (từ frontmatter) */
  lesson: number;
  /** slug bài, không kèm series/lang — ví dụ '03-first-widgets' */
  slug: string;
  en?: SeriesEntry;
  vi?: SeriesEntry;
}

/** Tách slug đầy đủ 'lvgl/en/03-first-widgets' -> { seriesId, lang, slug } */
function parse(entry: SeriesEntry) {
  const parts = entry.slug.split('/');
  return {
    seriesId: parts[0],
    lang: entry.data.lang,
    slug: parts[parts.length - 1],
  };
}

/**
 * Gom các bài của một series, ghép bản en/vi của cùng một bài lại,
 * và sắp theo số thứ tự bài.
 */
export async function getSeriesLessons(seriesId: string): Promise<LessonGroup[]> {
  const all = await getCollection('series', (e) => !e.data.draft);

  const groups = new Map<string, LessonGroup>();
  for (const entry of all) {
    const { seriesId: id, lang, slug } = parse(entry);
    if (id !== seriesId) continue;

    const g = groups.get(slug) ?? { lesson: entry.data.lesson, slug };
    g[lang] = entry;
    g.lesson = entry.data.lesson;
    groups.set(slug, g);
  }

  return [...groups.values()].sort((a, b) => a.lesson - b.lesson);
}

/**
 * Danh sách getStaticPaths dùng chung cho route tiếng Anh và tiếng Việt của
 * bài học. Gom vào một hàm để hai route không bao giờ lệch nhau về số trang.
 */
export async function lessonPaths() {
  const paths: {
    params: { series: string; slug: string };
    props: { group: LessonGroup; prev: LessonGroup | null; next: LessonGroup | null; total: number };
  }[] = [];

  for (const s of SERIES) {
    const lessons = await getSeriesLessons(s.id);
    lessons.forEach((group, i) => {
      paths.push({
        params: { series: s.id, slug: group.slug },
        props: {
          group,
          prev: i > 0 ? lessons[i - 1] : null,
          next: i < lessons.length - 1 ? lessons[i + 1] : null,
          total: lessons.length,
        },
      });
    });
  }

  return paths;
}

/** Số bài của một series (đếm theo số thứ tự bài, không nhân đôi vì 2 ngôn ngữ). */
export async function getSeriesLessonCount(seriesId: string): Promise<number> {
  return (await getSeriesLessons(seriesId)).length;
}
