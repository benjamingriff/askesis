import * as Sentry from '@sentry/react';
import { useAuth } from '@clerk/react';
import { useEffect } from 'react';
import {
  Navigate,
  Outlet,
  createBrowserRouter,
  isRouteErrorResponse,
  useLocation,
  useRouteError,
} from 'react-router';
import { AppShell } from './components/AppShell';
import { SignInPage, SignUpPage } from './routes/auth';
import { ChatPage } from './routes/chat';
import { SettingsPage } from './routes/settings';
import { PlanPage, PlansPage } from './routes/plans';
import { WorkoutsPage, workoutDetailLoader, workoutsLoader } from './routes/workouts';

function RequireAuthentication() {
  const { isSignedIn } = useAuth();
  const location = useLocation();

  if (!isSignedIn) {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

function ErrorPage() {
  const error = useRouteError();

  useEffect(() => {
    if (!isRouteErrorResponse(error)) Sentry.captureException(error);
  }, [error]);

  const message = isRouteErrorResponse(error)
    ? `${error.status}: ${error.statusText || error.data}`
    : 'An unexpected error occurred.';

  return (
    <main className="error-page">
      <p className="page-kicker">Askesis</p>
      <h1>Something went wrong</h1>
      <p>{message}</p>
      <button className="primary-button" type="button" onClick={() => window.location.reload()}>
        Try again
      </button>
    </main>
  );
}

export const router = createBrowserRouter([
  { path: '/sign-in/*', element: <SignInPage /> },
  { path: '/sign-up/*', element: <SignUpPage /> },
  {
    element: <RequireAuthentication />,
    children: [
      {
        element: <AppShell />,
        errorElement: <ErrorPage />,
        children: [
          { index: true, element: <Navigate to="/plan" replace /> },
          { path: '/plan', loader: workoutsLoader, element: <WorkoutsPage /> },
          { path: '/plans', element: <PlansPage /> },
          { path: '/plans/:planId', element: <PlanPage /> },
          { path: '/chat', element: <ChatPage /> },
          { path: '/chat/:conversationId', element: <ChatPage /> },
          { path: '/settings', element: <SettingsPage /> },
        ],
      },
      {
        path: '/workouts/:workoutId/detail',
        loader: workoutDetailLoader,
      },
    ],
  },
]);
