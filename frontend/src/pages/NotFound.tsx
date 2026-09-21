import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">404</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">This page does not exist</h1>
      <p className="mt-2 text-sm text-slate-600">The link may be outdated or the page was moved.</p>
      <Link to="/grants" className="btn-primary mt-6">
        Back to the grant catalogue
      </Link>
    </div>
  );
}
