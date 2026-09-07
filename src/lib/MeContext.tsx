import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { fetchMe, type MeResponse } from "./api";
import ChatModal from "../components/ChatModal";

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

type AuthErrorCode = "no_account" | "auth_failed";

const AUTH_ERROR_COPY: Record<AuthErrorCode, { headline: string; body: string }> = {
  no_account: {
    headline: "We couldn't find a matching order",
    body: "The email you signed in with doesn't match any paid order. Please make sure you sign in with the exact same email you used at checkout.",
  },
  auth_failed: {
    headline: "Something went wrong signing you in",
    body: "Please try again — if this keeps happening, message us and we'll sort it out.",
  },
};

function AuthErrorScreen({ code }: { code: AuthErrorCode }) {
  const [chatOpen, setChatOpen] = useState(false);
  const copy = AUTH_ERROR_COPY[code];

  const handleRetry = () => {
    // Clear the ?error= param before retrying so a repeated failure doesn't
    // silently loop — a fresh attempt always starts from a clean URL.
    //
    // no_account specifically means: this person completed a real WorkOS
    // sign-in/signup, but the email didn't match any paid order — most
    // likely because they mistyped it or used a different address than
    // the one they checked out with. Retrying should send them back
    // through account creation (?intent=signup), not a plain sign-in
    // retry, so they get another clean shot at entering the right email
    // from the start rather than landing on a screen that assumes they
    // already have an account. auth_failed is a generic exchange/session
    // failure unrelated to email matching, so it keeps the plain retry.
    window.location.href = code === "no_account" ? "/api/auth-start?intent=signup" : "/api/auth-start";
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-sm rounded-2xl border border-ink/10 bg-white p-6 text-center sm:p-8">
        <p className="text-sm font-semibold text-brand-blue">Sign-In Problem</p>
        <h1 className="mt-1 text-xl font-bold text-brand-navy">{copy.headline}</h1>
        <p className="mt-2 text-sm text-ink/60">{copy.body}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex items-center justify-center rounded-full bg-brand-blue px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#0b57cc]"
          >
            Try Again
          </button>
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="inline-flex items-center justify-center rounded-full border border-ink/15 px-6 py-3 text-sm font-semibold text-brand-navy transition hover:border-brand-blue hover:text-brand-blue"
          >
            Message Us
          </button>
        </div>
      </div>
      <ChatModal open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}

function readAuthErrorFromUrl(): AuthErrorCode | null {
  const value = new URLSearchParams(window.location.search).get("error");
  return value === "no_account" || value === "auth_failed" ? value : null;
}

export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // Read once — the URL doesn't change without a full page navigation
  // (the retry/logout paths in this file always do a hard redirect), so
  // this never needs to be reactive state.
  const [authError] = useState<AuthErrorCode | null>(() => readAuthErrorFromUrl());
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    // If auth-callback already told us what went wrong, show that instead
    // of blindly redirecting back into another login attempt — that's what
    // was producing an infinite auth-start <-> auth-callback loop for a
    // customer who signed in with the wrong email.
    if (authError) return;

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
  }, [nonce, authError]);

  if (authError) {
    return <AuthErrorScreen code={authError} />;
  }

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
