import { defineConfig } from 'astro/config';

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL,
  output: 'static',
  server: { host: '127.0.0.1', port: Number(process.env.MARKETING_PORT ?? 4321) },
  vite: { server: { strictPort: true } },
  devToolbar: { enabled: false },
});
