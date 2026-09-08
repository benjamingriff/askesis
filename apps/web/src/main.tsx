import * as Sentry from '@sentry/react';
import { ClerkProvider, useAuth } from '@clerk/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { configureAuthTokenProvider } from './api';
import { router } from './router';
import { AccountQueryProvider } from './query-provider';
import './styles.css';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  enabled: import.meta.env.PROD && Boolean(import.meta.env.VITE_SENTRY_DSN),
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_SENTRY_RELEASE,
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

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (publishableKey === undefined || publishableKey.length === 0) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');
}

function AuthenticatedRouter() {
  const { getToken, isLoaded, userId } = useAuth();

  if (!isLoaded) {
    return (
      <div className="auth-loading">
        <span className="brand-mark">A</span>
        <p>Loading Askesis…</p>
      </div>
    );
  }

  configureAuthTokenProvider(getToken);
  return (
    <AccountQueryProvider key={userId ?? 'signed-out'} accountId={userId ?? 'signed-out'}>
      <RouterProvider router={router} />
    </AccountQueryProvider>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignOutUrl="/sign-in"
      appearance={{
        variables: {
          colorPrimary: '#171717',
          borderRadius: '0.625rem',
        },
      }}
    >
      <AuthenticatedRouter />
    </ClerkProvider>
  </StrictMode>,
);
