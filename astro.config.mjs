import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import { visit } from 'unist-util-visit';

/**
 * Bọc mỗi <table> trong markdown bằng <div class="table-scroll">.
 * Bảng trong các bài học khá rộng; nếu không bọc, nó đẩy tràn cả trang
 * trên màn hình hẹp. Bọc lại thì chỉ riêng bảng cuộn ngang.
 */
function rehypeWrapTables() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'table' || !parent || parent.tagName === 'div') return;
      if (parent.properties?.className?.includes?.('table-scroll')) return;

      parent.children[index] = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['table-scroll'] },
        children: [node],
      };
    });
  };
}

export default defineConfig({
  site: 'https://dantng.github.io',
  base: '/MyPortfolio',
  integrations: [
    tailwind(),
  ],
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      wrap: true,
    },
    rehypePlugins: [rehypeWrapTables],
  },
});
