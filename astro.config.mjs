import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://scalingthoughts.com',
  integrations: [tailwind(), mdx()],
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
    },
  },
});
