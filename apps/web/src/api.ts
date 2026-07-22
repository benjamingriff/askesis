import { createAskesisClient } from '@askesis/api-client';

export const api = createAskesisClient(import.meta.env.VITE_API_BASE_URL ?? '');
