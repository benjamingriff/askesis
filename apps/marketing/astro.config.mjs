import { defineConfig } from 'astro/config';

export default defineConfig({
  // Canonical and social-card URLs are absolute. Set SITE_URL once the marketing domain exists.
  site: process.env.SITE_URL ?? 'http://localhost:4321',
  devToolbar: { enabled: false },
  server: {
    port: Number(process.env.MARKETING_PORT ?? 4321),
  },
});
