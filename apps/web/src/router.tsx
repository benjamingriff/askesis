import { createBrowserRouter, isRouteErrorResponse, useRouteError } from 'react-router';
import { WorkoutsPage, workoutDetailLoader, workoutsLoader } from './routes/workouts';

function ErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status}: ${error.statusText || error.data}`
    : 'An unexpected error occurred.';

  return (
    <main className="error-page">
      <p className="eyebrow">Askesis</p>
      <h1>Unable to load the plan</h1>
      <p>{message}</p>
      <button type="button" onClick={() => window.location.reload()}>Try again</button>
    </main>
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    loader: workoutsLoader,
    element: <WorkoutsPage />,
    errorElement: <ErrorPage />,
  },
  {
    path: '/workouts/:workoutId/detail',
    loader: workoutDetailLoader,
  },
]);
