import { useClerk, useUser } from '@clerk/react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FileText,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Plus,
  Settings,
  UserRound,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';

const mockChats = [
  { id: 'travel-week', title: 'Adjust next week around travel' },
  { id: 'hill-session', title: 'Explain Wednesday’s hill session' },
  { id: 'cardiff-goal', title: 'Review my Cardiff goal' },
];

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const { user } = useUser();
  const clerk = useClerk();
  const displayName = user?.fullName ?? user?.firstName ?? 'Askesis athlete';
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const initials =
    displayName
      .split(/\s+/)
      .map((part) => part.at(0))
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'A';

  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      <button
        className="mobile-menu-button"
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
      >
        <Menu size={20} />
      </button>
      {mobileOpen && (
        <button
          className="mobile-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside className={`primary-sidebar${mobileOpen ? ' mobile-open' : ''}`}>
        <div className="brand-row">
          <NavLink
            to="/plan"
            className="brand"
            onClick={() => setMobileOpen(false)}
            aria-label="Askesis plan"
          >
            <span className="brand-mark">A</span>
            <strong>Askesis</strong>
          </NavLink>
          <button
            className="icon-button sidebar-close-mobile"
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
          <button
            className="icon-button sidebar-collapse"
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          </button>
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          <NavLink to="/plans" onClick={() => setMobileOpen(false)}>
            <FileText size={19} />
            <span>Plan library</span>
          </NavLink>
          <NavLink to="/plan" onClick={() => setMobileOpen(false)}>
            <CalendarDays size={19} />
            <span>Plan</span>
          </NavLink>
          <NavLink to="/chat" onClick={() => setMobileOpen(false)}>
            <MessageSquare size={19} />
            <span>Chat</span>
          </NavLink>
        </nav>

        <div className="sidebar-section chat-history-nav">
          <div className="sidebar-section-heading">
            <span>Chats</span>
            <NavLink to="/chat" aria-label="New chat">
              <Plus size={16} />
            </NavLink>
          </div>
          <div className="sidebar-chat-list">
            {mockChats.map((chat) => (
              <NavLink to={`/chat/${chat.id}`} key={chat.id} onClick={() => setMobileOpen(false)}>
                {chat.title}
              </NavLink>
            ))}
          </div>
        </div>

        <div className="sidebar-spacer" />
        <nav className="utility-nav">
          <NavLink to="/settings">
            <Settings size={18} />
            <span>Settings</span>
          </NavLink>
          <a href="/api/docs">
            <FileText size={18} />
            <span>API docs</span>
          </a>
        </nav>

        <div className="account-area">
          {accountOpen && (
            <div className="account-popover">
              <div className="account-popover-identity">
                <strong>{displayName}</strong>
                <span>{email}</span>
              </div>
              <button type="button" onClick={() => clerk.openUserProfile()}>
                <UserRound size={16} /> Profile
              </button>
              <button type="button">
                <Moon size={16} /> Appearance
              </button>
              <button type="button">
                <CircleHelp size={16} /> Help
              </button>
              <button type="button" onClick={() => void clerk.signOut({ redirectUrl: '/sign-in' })}>
                <LogOut size={16} /> Sign out
              </button>
            </div>
          )}
          <button
            className="account-button"
            type="button"
            onClick={() => setAccountOpen((value) => !value)}
            aria-expanded={accountOpen}
          >
            {user?.hasImage ? (
              <img className="avatar" src={user.imageUrl} alt="" />
            ) : (
              <span className="avatar">{initials}</span>
            )}
            <span className="account-copy">
              <strong>{displayName}</strong>
              <small>{email || 'Personal account'}</small>
            </span>
            <span className="account-more">•••</span>
          </button>
        </div>
      </aside>

      <div className="workspace">
        <Outlet />
      </div>
    </div>
  );
}
