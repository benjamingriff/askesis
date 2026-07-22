import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import { registerWorkoutRoutes } from './modules/workouts/workout.routes.js';

export const app = new OpenAPIHono();

app.onError((error, context) => {
  console.error(error);
  return context.json({ error: 'Internal server error' }, 500);
});

app.get('/api/health', (context) => context.json({ status: 'ok' }));

registerWorkoutRoutes(app);

app.doc('/api/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Askesis API',
    version: '0.1.0',
    description: 'Domain API for structured training plans.',
  },
});

app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }));
