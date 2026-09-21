import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import type { Notification } from '../lib/types';

type NavItem = { to: string; label: string; end?: boolean };

const APPLICANT_LINKS: NavItem[] = [
  { to: '/grants', label: 'Grants' },
  { to: '/applications', label: 'My applications' },
];

// Staff already have an admin "Grants" entry, so the public catalogue is
// labelled differently to keep the two apart.
const STAFF_APPLICANT_LINKS: NavItem[] = [
  { to: '/grants', label: 'Public catalogue' },
  { to: '/applications', label: 'My applications' },
];

const STAFF_LINKS: NavItem[] = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/applications', label: 'Applications' },
  { to: '/admin/grants', label: 'Grants' },
];

const ADMIN_ONLY_LINKS: NavItem[] = [
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/audit', label: 'Audit log' },
];

export default function Layout() {
  const { user, logout, isStaff, hasRole } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const links = [
    ...(isStaff ? STAFF_LINKS : []),
    ...(hasRole('admin') ? ADMIN_ONLY_LINKS : []),
    ...(isStaff ? STAFF_APPLICANT_LINKS : APPLICANT_LINKS),
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link to={isStaff ? '/admin' : '/grants'} className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-sm font-bold text-white">
              GP
            </span>
            <span className="text-base font-bold tracking-tight text-slate-900">Grant Portal</span>
          </Link>

          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {user && <NotificationBell />}
            {user ? (
              <div className="flex items-center gap-2">
                <Link
                  to="/profile"
                  className="hidden text-right text-sm leading-tight sm:block"
                  title="Edit your profile"
                >
                  <span className="block font-semibold text-slate-800">{user.name}</span>
                  <span className="block text-xs capitalize text-slate-500">{user.role}</span>
                </Link>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={async () => {
                    await logout();
                    navigate('/login');
                  }}
                >
                  Sign out
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link to="/login" className="btn-secondary btn-sm">
                  Sign in
                </Link>
                <Link to="/register" className="btn-primary btn-sm">
                  Create account
                </Link>
              </div>
            )}
            <button
              type="button"
              className="btn-ghost btn-sm md:hidden"
              aria-expanded={menuOpen}
              aria-label="Toggle navigation"
              onClick={() => setMenuOpen((open) => !open)}
            >
              Menu
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="border-t border-slate-200 bg-white px-4 py-2 md:hidden">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-2 text-sm font-medium ${
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white py-6">
        <div className="mx-auto max-w-7xl px-4 text-xs text-slate-500 sm:px-6">
          Grant Portal — apply, track and review funding applications.
        </div>
      </footer>
    </div>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const data = await api.get<{ items: Notification[]; unread: number }>('/notifications?take=15');
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      /* the bell is non-critical */
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const markAll = async () => {
    await api.post('/notifications/read-all');
    await load();
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
          <path
            d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="card absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-800">Notifications</span>
            {unread > 0 && (
              <button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">Nothing yet.</p>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className={`border-b border-slate-100 px-4 py-3 last:border-0 ${item.readAt ? '' : 'bg-brand-50/40'}`}
                >
                  <p className="text-sm font-medium text-slate-800">{item.subject}</p>
                  <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-slate-600">{item.body}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{relativeTime(item.createdAt)}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
