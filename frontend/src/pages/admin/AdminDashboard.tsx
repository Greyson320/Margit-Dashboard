import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { STATUS_CHART_COLORS, STATUS_LABELS, daysUntil, formatDate, formatMoney } from '../../lib/format';
import { Alert, Loading, StatCard } from '../../components/ui';
import type { ApplicationStatus, StatsOverview } from '../../lib/types';

type TimelinePoint = { date: string; created: number; submitted: number };

export default function AdminDashboard() {
  const { hasRole } = useAuth();
  const toast = useToast();
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingReminders, setSendingReminders] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [overview, trend] = await Promise.all([
          api.get<StatsOverview>('/stats/overview'),
          api.get<{ items: TimelinePoint[] }>('/stats/timeline?days=30'),
        ]);
        if (!cancelled) {
          setStats(overview);
          setTimeline(trend.items);
        }
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : 'Could not load the dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendReminders = async () => {
    setSendingReminders(true);
    try {
      const result = await api.post<{ sent: number }>('/notifications/deadline-reminders', { days: 7 });
      toast.success(
        result.sent === 0
          ? 'No drafts are approaching a deadline right now'
          : `Sent ${result.sent} deadline reminder${result.sent === 1 ? '' : 's'}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send reminders');
    } finally {
      setSendingReminders(false);
    }
  };

  if (loading) return <Loading label="Crunching the numbers…" />;
  if (!stats) return <Alert tone="error">The dashboard data could not be loaded.</Alert>;

  const statusData = (Object.keys(STATUS_LABELS) as ApplicationStatus[])
    .map((status) => ({ status, name: STATUS_LABELS[status], value: stats.applications.by_status[status] ?? 0 }))
    .filter((entry) => entry.value > 0);

  const trendData = timeline.map((point) => ({
    ...point,
    label: new Date(point.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">Programme overview across every grant round.</p>
        </div>
        <div className="flex gap-2">
          {hasRole('admin') && (
            <button type="button" className="btn-secondary" onClick={sendReminders} disabled={sendingReminders}>
              {sendingReminders ? 'Sending…' : 'Send deadline reminders'}
            </button>
          )}
          <Link to="/admin/applications" className="btn-primary">
            Review applications
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Applications"
          value={stats.applications.total}
          hint={`${stats.applications.last_30_days} in the last 30 days`}
        />
        <StatCard
          label="Awaiting decision"
          value={stats.applications.awaiting_decision}
          tone="amber"
          hint="Submitted or under review"
        />
        <StatCard
          label="Approval rate"
          value={stats.applications.approval_rate === null ? '—' : `${stats.applications.approval_rate}%`}
          tone="emerald"
          hint="Of all decided applications"
        />
        <StatCard
          label="Open calls"
          value={stats.grants.open}
          tone="brand"
          hint={`${stats.grants.total} grants · ${formatMoney(stats.grants.total_budget)} total budget`}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card p-6 lg:col-span-2">
          <h2 className="text-base font-semibold text-slate-900">Applications over the last 30 days</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="created" name="Started" stroke="#94a3b8" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="submitted" name="Submitted" stroke="#375ef6" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-base font-semibold text-slate-900">By status</h2>
          {statusData.length === 0 ? (
            <p className="mt-6 text-sm text-slate-500">No applications yet.</p>
          ) : (
            <div className="mt-2 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {statusData.map((entry) => (
                      <Cell key={entry.status} fill={STATUS_CHART_COLORS[entry.status]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-6">
          <h2 className="text-base font-semibold text-slate-900">Applications per grant</h2>
          {stats.per_grant.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No applications yet.</p>
          ) : (
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={stats.per_grant.map((row) => ({ name: row.title, total: row.total }))}
                  layout="vertical"
                  margin={{ left: 8, right: 16 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={160}
                    tick={{ fontSize: 11, fill: '#334155' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                  <Bar dataKey="total" name="Applications" fill="#375ef6" radius={[0, 6, 6, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card p-6">
          <h2 className="text-base font-semibold text-slate-900">Deadlines in the next two weeks</h2>
          {stats.grants.closing_soon.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">Nothing closing soon.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {stats.grants.closing_soon.map((grant) => {
                const remaining = daysUntil(grant.deadline);
                return (
                  <li key={grant.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <Link to={`/admin/grants/${grant.id}`} className="text-sm font-medium text-slate-800 hover:text-brand-700">
                        {grant.title}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {formatDate(grant.deadline)} · {grant.application_count} application
                        {grant.application_count === 1 ? '' : 's'}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                        (remaining ?? 99) <= 3 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {remaining}d
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
