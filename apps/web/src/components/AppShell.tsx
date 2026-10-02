import { useUser } from '@clerk/react';
import {
  CalendarDays,
  Library,
  MessageSquarePlus,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Zap,
  CircleUserRound,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useConversations } from '../chat';
import { cx } from './ui';

const TABS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/today', label: 'Today', icon: Zap },
  { to: '/plan', label: 'Plan', icon: CalendarDays },
  { to: '/chat', label: 'Coach', icon: MessagesSquare },
  { to: '/settings', label: 'You', icon: CircleUserRound },
];

export function initialsFor(name: string) {
  return (
    name
      .split(/\s+/)
      .map((part) => part.at(0))
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'A'
  );
}

/**
 * Desktop: a T3 Code-style sidebar with navigation and recent chats.
 * Narrow screens: the mobile app's floating tab bar.
 */
export function AppShell() {
  const chats = useConversations();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('askesis-sidebar-collapsed') === 'true',
  );
  const { user } = useUser();
  const onChat = useLocation().pathname.startsWith('/chat');
  const displayName = user?.fullName ?? user?.firstName ?? 'Askesis athlete';
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const toggle = () =>
    setCollapsed((value) => {
      localStorage.setItem('askesis-sidebar-collapsed', String(!value));
      return !value;
    });

  return (
    <div className={cx('app-shell', collapsed && 'sidebar-collapsed', onChat && 'on-chat')}>
      <aside className="sidebar" aria-label="Sidebar">
        <div className="sidebar-brand">
          <Link to="/today" className="brand" aria-label="Askesis home">
            <span className="brand-mark">A</span>
            <strong>Askesis</strong>
          </Link>
          <button
            type="button"
            className="icon-btn icon-btn-plain"
            onClick={toggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <Link to="/chat/new" className="sidebar-new-chat" title="New chat">
          <MessageSquarePlus size={17} aria-hidden="true" />
          <span>New chat</span>
        </Link>

        <nav className="sidebar-nav" aria-label="Primary navigation">
          {TABS.slice(0, 3).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} title={label}>
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
          <NavLink to="/plans" end={false} title="All plans">
            <Library size={18} aria-hidden="true" />
            <span>All plans</span>
          </NavLink>
        </nav>

        <div className="sidebar-section">
          <span className="label">Recent chats</span>
          <div className="sidebar-chats">
            {chats.data?.pages[0]?.conversations.slice(0, 12).map((chat) => (
              <NavLink to={`/chat/${chat.id}`} key={chat.id} title={chat.title}>
                <span>{chat.title}</span>
                {chat.planName ? <small>{chat.planName}</small> : null}
              </NavLink>
            ))}
            {chats.error ? <span className="muted">Could not load chats.</span> : null}
            {chats.data && !chats.data.pages[0]?.conversations.length ? (
              <span className="muted">No chats yet.</span>
            ) : null}
          </div>
        </div>

        <NavLink to="/settings" className="sidebar-account" title="You">
          {user?.hasImage ? (
            <img className="avatar" src={user.imageUrl} alt="" />
          ) : (
            <span className="avatar">{initialsFor(displayName)}</span>
          )}
          <span className="account-copy">
            <strong>{displayName}</strong>
            <small>{email || 'Personal account'}</small>
          </span>
        </NavLink>
      </aside>

      <div className="workspace">
        <Outlet />
      </div>

      <nav className="tab-bar" aria-label="Primary navigation">
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className="tab">
            <Icon size={22} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
