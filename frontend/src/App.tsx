import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import Layout from './components/Layout';
import { Loading } from './components/ui';
import { useAuth } from './context/AuthContext';
import type { Role } from './lib/types';

import Login from './pages/Login';
import Register from './pages/Register';
import Profile from './pages/Profile';
import GrantsCatalog from './pages/GrantsCatalog';
import GrantDetail from './pages/GrantDetail';
import ApplicationForm from './pages/ApplicationForm';
import MyApplications from './pages/MyApplications';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminGrants from './pages/admin/AdminGrants';
import AdminGrantEditor from './pages/admin/AdminGrantEditor';
import AdminApplications from './pages/admin/AdminApplications';
import AdminApplicationDetail from './pages/admin/AdminApplicationDetail';
import AdminUsers from './pages/admin/AdminUsers';
import AdminAudit from './pages/admin/AdminAudit';
import NotFound from './pages/NotFound';

function Protected({ children, roles }: { children: ReactElement; roles?: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading label="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/grants" replace />;
  return children;
}

function Landing() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/grants" replace />;
  return <Navigate to={user.role === 'applicant' ? '/grants' : '/admin'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />

        <Route path="grants" element={<GrantsCatalog />} />
        <Route path="grants/:id" element={<GrantDetail />} />

        <Route
          path="profile"
          element={
            <Protected>
              <Profile />
            </Protected>
          }
        />
        <Route
          path="applications"
          element={
            <Protected>
              <MyApplications />
            </Protected>
          }
        />
        <Route
          path="applications/:id"
          element={
            <Protected>
              <ApplicationForm />
            </Protected>
          }
        />

        <Route
          path="admin"
          element={
            <Protected roles={['admin', 'reviewer']}>
              <AdminDashboard />
            </Protected>
          }
        />
        <Route
          path="admin/applications"
          element={
            <Protected roles={['admin', 'reviewer']}>
              <AdminApplications />
            </Protected>
          }
        />
        <Route
          path="admin/applications/:id"
          element={
            <Protected roles={['admin', 'reviewer']}>
              <AdminApplicationDetail />
            </Protected>
          }
        />
        <Route
          path="admin/grants"
          element={
            <Protected roles={['admin']}>
              <AdminGrants />
            </Protected>
          }
        />
        <Route
          path="admin/grants/new"
          element={
            <Protected roles={['admin']}>
              <AdminGrantEditor />
            </Protected>
          }
        />
        <Route
          path="admin/grants/:id"
          element={
            <Protected roles={['admin']}>
              <AdminGrantEditor />
            </Protected>
          }
        />
        <Route
          path="admin/users"
          element={
            <Protected roles={['admin']}>
              <AdminUsers />
            </Protected>
          }
        />
        <Route
          path="admin/audit"
          element={
            <Protected roles={['admin']}>
              <AdminAudit />
            </Protected>
          }
        />

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
