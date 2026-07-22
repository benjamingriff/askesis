import { Bell, Palette, UserRound } from 'lucide-react';

export function SettingsPage() {
  return (
    <main className="settings-page">
      <header className="simple-page-header"><p className="page-kicker">Account</p><h1>Settings</h1><p>Account management is represented with placeholder data while authentication is being designed.</p></header>
      <div className="settings-grid">
        <nav>
          <a className="active" href="#profile"><UserRound size={17} /> Profile</a>
          <a href="#appearance"><Palette size={17} /> Appearance</a>
          <a href="#notifications"><Bell size={17} /> Notifications</a>
        </nav>
        <section id="profile" className="settings-card">
          <h2>Profile</h2><p>This information is currently hardcoded.</p>
          <div className="profile-hero"><span className="large-avatar">BG</span><div><strong>Benjamin Griffiths</strong><span>Personal account</span></div><button className="secondary-button" type="button" disabled>Change photo</button></div>
          <label>Full name<input value="Benjamin Griffiths" readOnly /></label>
          <label>Email address<input value="benjamin@example.com" readOnly /></label>
          <button className="primary-button" type="button" disabled>Save changes</button>
        </section>
      </div>
    </main>
  );
}
