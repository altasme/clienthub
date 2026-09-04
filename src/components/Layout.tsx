import { NavLink, Outlet } from "react-router-dom";
import { logout } from "../lib/api";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm font-semibold transition ${isActive ? "text-brand-blue" : "text-ink/60 hover:text-ink"}`;

export default function Layout() {
  const handleLogout = () => {
    logout().finally(() => {
      window.location.href = "/";
    });
  };

  return (
    <div className="min-h-screen bg-paper-alt">
      <header className="border-b border-ink/5 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-blue">Altaventures</p>
            <p className="text-lg font-bold text-brand-navy">Client Hub</p>
          </div>
          <nav className="flex items-center gap-6">
            <NavLink to="/" end className={navLinkClass}>
              Dashboard
            </NavLink>
            <NavLink to="/website" className={navLinkClass}>
              Website
            </NavLink>
            <NavLink to="/account" className={navLinkClass}>
              Account
            </NavLink>
            <button type="button" onClick={handleLogout} className="text-sm font-semibold text-ink/40 hover:text-ink/70">
              Log Out
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}
