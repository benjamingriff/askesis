import { useUser } from '@clerk/react';
import {
  CalendarDays,
  Gauge,
  Library,
  MessageSquarePlus,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useRef, useState, type CSSProperties } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useConversations } from '../chat';
import { readStorage, writeStorage } from '../lib/storage';
import { useTabSwipe } from '../lib/tab-swipe';
import { cx } from './ui';

const TABS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/today', label: 'Today', icon: Zap },
  { to: '/plan', label: 'Plan', icon: CalendarDays },
  { to: '/chat', label: 'Coach', icon: MessagesSquare },
];

/** Pages you can swipe between: each tab's landing page, not its detail pages. */
const SWIPE_PAGES = TABS.map(({ to }) => to);

function sectionIndex(pathname: string) {
  // `/plan` also covers the plan library and plan detail pages under `/plans`.
  return TABS.findIndex(({ to }) => pathname.startsWith(to));
}

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
 * Narrow screens: a slim bar above the page with You and Today · Plan · Coach, swipeable between tabs.
 */
export function AppShell() {
  const chats = useConversations();
  const [collapsed, setCollapsed] = useState(
    () => readStorage('askesis-sidebar-collapsed') === 'true',
  );
  const { user } = useUser();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const onChat = pathname.startsWith('/chat');
  const active = sectionIndex(pathname);
  const workspace = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLElement>(null);
  useTabSwipe(workspace, tabs, {
    index: SWIPE_PAGES.includes(pathname) ? active : -1,
    count: TABS.length,
    onCommit: (index) => void navigate(TABS[index]!.to, { flushSync: true }),
  });
  const displayName = user?.fullName ?? user?.firstName ?? 'Askesis athlete';
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const toggle = () =>
    setCollapsed((value) => {
      writeStorage('askesis-sidebar-collapsed', String(!value));
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
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} title={label}>
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
          <NavLink to="/plans" end={false} title="All plans">
            <Library size={18} aria-hidden="true" />
            <span>All plans</span>
          </NavLink>
          <NavLink to="/performance" title="Performance">
            <Gauge size={18} aria-hidden="true" />
            <span>Performance</span>
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

      {/* Scrolls away with the page: scroll back to the top to switch screens. */}
      <header className="top-bar">
        <NavLink to="/settings" className="top-bar-account" aria-label="You" title="You">
          {initialsFor(displayName)}
        </NavLink>
        <nav
          ref={tabs}
          className="top-tabs"
          aria-label="Primary navigation"
          style={{ '--tab-index': Math.max(active, 0) } as CSSProperties}
        >
          {TABS.map(({ to, label }, index) => (
            <Link
              key={to}
              to={to}
              className={cx('top-tab', index === active && 'active')}
              aria-current={index === active ? 'page' : undefined}
              onClick={() => window.scrollTo(0, 0)}
            >
              {label}
            </Link>
          ))}
          {active >= 0 ? <span className="top-tab-indicator" aria-hidden="true" /> : null}
        </nav>
      </header>

      <div className="workspace" ref={workspace}>
        <Outlet />
      </div>
    </div>
  );
}
