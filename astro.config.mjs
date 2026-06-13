import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://dantng.github.io/myportfolio',
  base: '/',
  integrations: [
    tailwind(),
    ...(process.env.SITE ? [sitemap()] : []),
  ],
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      wrap: true,
    },
  },
});
