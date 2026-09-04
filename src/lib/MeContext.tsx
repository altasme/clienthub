import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { fetchMe, type MeResponse } from "./api";

interface MeContextValue {
  me: MeResponse;
  refresh: () => void;
}

const MeContext = createContext<MeContextValue | null>(null);

export function useMe(): MeContextValue {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe must be used within MeProvider");
  return ctx;
}

export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetchMe()
      .then((result) => {
        if (cancelled) return;
        if (result === "unauthenticated") {
          window.location.href = "/api/auth-start";
          return;
        }
        setMe(result);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-ink/50">Loading your account&hellip;</p>
      </div>
    );
  }

  if (status === "error" || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <p className="text-sm text-ink/60">
          We couldn't load your account right now. Please refresh the page, or message us if this keeps happening.
        </p>
      </div>
    );
  }

  return <MeContext.Provider value={{ me, refresh }}>{children}</MeContext.Provider>;
}
