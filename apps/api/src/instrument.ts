import * as Sentry from '@sentry/node';
import { getApiConfig } from './config.js';

const config = getApiConfig();
const dsn = config.SENTRY_DSN === '' ? undefined : config.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: config.NODE_ENV === 'production' && dsn !== undefined,
  environment: config.NODE_ENV,
  release: config.SENTRY_RELEASE,
  sendDefaultPii: false,
  beforeSend(event) {
    if (event.request !== undefined) {
      delete event.request.data;
      delete event.request.cookies;
      if (event.request.headers !== undefined) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
    }
    return event;
  },
});
