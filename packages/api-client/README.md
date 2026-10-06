# Askesis API client

This package contains the generated OpenAPI schema types and a small `openapi-fetch` public API client factory used by the web application. The OpenAI Agents worker uses a separate hand-written fetch/Zod client for machine-authenticated internal API routes.

Regenerate it from the Hono route schemas with:

```bash
pnpm generate:openapi
```

Do not edit `openapi.json` or `src/schema.ts` manually.
