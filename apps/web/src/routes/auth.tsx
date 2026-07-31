import { SignIn, SignUp, useAuth } from '@clerk/react';
import { Navigate } from 'react-router';

export function SignInPage() {
  const { isSignedIn } = useAuth();
  if (isSignedIn) return <Navigate to="/plan" replace />;

  return (
    <main className="auth-page">
      <div className="auth-brand">
        <span className="brand-mark">A</span>
        <strong>Askesis</strong>
      </div>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" forceRedirectUrl="/plan" />
      <p>Structured training, adapted around you.</p>
    </main>
  );
}

export function SignUpPage() {
  const { isSignedIn } = useAuth();
  if (isSignedIn) return <Navigate to="/plan" replace />;

  return (
    <main className="auth-page">
      <div className="auth-brand">
        <span className="brand-mark">A</span>
        <strong>Askesis</strong>
      </div>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" forceRedirectUrl="/plan" />
      <p>Create your Askesis athlete profile.</p>
    </main>
  );
}
