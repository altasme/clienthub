import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { logout, dismissWelcome } from "../lib/api";
import { useMe } from "../lib/MeContext";
import WelcomeModal from "./WelcomeModal";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm font-semibold transition ${isActive ? "text-brand-blue" : "text-ink/60 hover:text-ink"}`;

export default function Layout() {
  const { me, refresh } = useMe();
  // Optimistic local hide so the modal disappears instantly on dismiss
  // rather than waiting on the refresh() round-trip; the real, durable
  // state is still me.client.hasSeenWelcome from the server.
  const [locallyDismissed, setLocallyDismissed] = useState(false);

  const handleLogout = () => {
    logout().finally(() => {
      window.location.href = "/";
    });
  };

  const handleDismissWelcome = () => {
    setLocallyDismissed(true);
    dismissWelcome()
      .then(() => refresh())
      .catch(() => {
        // Best-effort: if this fails, the modal just reappears on the
        // client's next login (welcome_dismissed_at never got set) —
        // not worth blocking the UI over, since dismissing again is
        // trivial.
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

      <WelcomeModal open={!me.client.hasSeenWelcome && !locallyDismissed} onDismiss={handleDismissWelcome} />
    </div>
  );
}
