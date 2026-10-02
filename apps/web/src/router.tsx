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
import { ActivePlansPage } from './routes/active-plans';
import { PlanRevisionPage } from './routes/plan-history';
import { PlanDraftPage } from './routes/plan-draft';
import { PlanBriefPage } from './routes/plan-brief';
import { TodayPage } from './routes/today';

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
      <span className="label">Askesis</span>
      <h1>Something went wrong</h1>
      <p className="muted">{message}</p>
      <button
        className="btn btn-primary btn-md"
        type="button"
        onClick={() => window.location.reload()}
      >
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
          { index: true, element: <Navigate to="/today" replace /> },
          { path: '/today', element: <TodayPage /> },
          { path: '/plan', element: <ActivePlansPage /> },
          { path: '/plans/archive', element: <PlansPage archived /> },
          { path: '/plans', element: <PlansPage /> },
          { path: '/plans/:planId', element: <PlanPage /> },
          { path: '/plans/:planId/draft', element: <PlanDraftPage /> },
          { path: '/plans/:planId/brief', element: <PlanBriefPage /> },
          { path: '/plans/:planId/versions/:revisionId/brief', element: <PlanBriefPage /> },
          { path: '/plans/:planId/versions/:revisionId', element: <PlanRevisionPage /> },
          { path: '/chat', element: <ChatPage /> },
          { path: '/chat/new', element: <ChatPage composing /> },
          { path: '/chat/archive', element: <ChatPage archived /> },
          { path: '/chat/:conversationId', element: <ChatPage /> },
          { path: '/settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
]);
