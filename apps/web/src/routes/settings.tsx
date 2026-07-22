import { useClerk, useUser } from '@clerk/react';
import { Bell, Palette, UserRound } from 'lucide-react';

export function SettingsPage() {
  const { user } = useUser();
  const clerk = useClerk();
  const displayName = user?.fullName ?? user?.firstName ?? 'Askesis athlete';
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const initials = displayName.split(/\s+/).map((part) => part.at(0)).join('').slice(0, 2).toUpperCase() || 'A';

  return (
    <main className="settings-page">
      <header className="simple-page-header"><p className="page-kicker">Account</p><h1>Settings</h1><p>Your identity and sign-in methods are securely managed by Clerk.</p></header>
      <div className="settings-grid">
        <nav>
          <a className="active" href="#profile"><UserRound size={17} /> Profile</a>
          <a href="#appearance"><Palette size={17} /> Appearance</a>
          <a href="#notifications"><Bell size={17} /> Notifications</a>
        </nav>
        <section id="profile" className="settings-card">
          <h2>Profile</h2><p>Update your profile, email, password, and connected accounts through Clerk.</p>
          <div className="profile-hero">
            {user?.hasImage ? <img className="large-avatar" src={user.imageUrl} alt="" /> : <span className="large-avatar">{initials}</span>}
            <div><strong>{displayName}</strong><span>Personal account</span></div>
            <button className="secondary-button" type="button" onClick={() => clerk.openUserProfile()}>Manage account</button>
          </div>
          <label>Full name<input value={displayName} readOnly /></label>
          <label>Email address<input value={email} readOnly /></label>
          <button className="primary-button" type="button" onClick={() => clerk.openUserProfile()}>Edit in Clerk</button>
        </section>
      </div>
    </main>
  );
}
