import { Navigate, createBrowserRouter, isRouteErrorResponse, useRouteError } from 'react-router';
import { AppShell } from './components/AppShell';
import { ChatPage } from './routes/chat';
import { SettingsPage } from './routes/settings';
import { WorkoutsPage, workoutDetailLoader, workoutsLoader } from './routes/workouts';

function ErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status}: ${error.statusText || error.data}`
    : 'An unexpected error occurred.';

  return (
    <main className="error-page">
      <p className="page-kicker">Askesis</p>
      <h1>Something went wrong</h1>
      <p>{message}</p>
      <button className="primary-button" type="button" onClick={() => window.location.reload()}>Try again</button>
    </main>
  );
}

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Navigate to="/plan" replace /> },
      { path: '/plan', loader: workoutsLoader, element: <WorkoutsPage /> },
      { path: '/chat', element: <ChatPage /> },
      { path: '/chat/:conversationId', element: <ChatPage /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
  {
    path: '/workouts/:workoutId/detail',
    loader: workoutDetailLoader,
  },
]);
