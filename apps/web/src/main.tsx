import { ClerkProvider, useAuth } from '@clerk/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { configureAuthTokenProvider } from './api';
import { router } from './router';
import './styles.css';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (publishableKey === undefined || publishableKey.length === 0) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');
}

function AuthenticatedRouter() {
  const { getToken, isLoaded } = useAuth();

  if (!isLoaded) {
    return <div className="auth-loading"><span className="brand-mark">A</span><p>Loading Askesis…</p></div>;
  }

  configureAuthTokenProvider(getToken);
  return <RouterProvider router={router} />;
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
