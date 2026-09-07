import { useState } from "react";
import { useMe } from "../lib/MeContext";
import ProgressRail from "../components/ProgressRail";
import ChatModal from "../components/ChatModal";
import BookingModal from "../components/BookingModal";
import { ensureAbsoluteUrl } from "../lib/url";

const DAY_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  weekday: "long",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 flex-shrink-0 text-green-600">
      <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 111.4-1.4l2.8 2.8 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
    </svg>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-ink/10 bg-white p-6 sm:p-8">{children}</div>;
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-full bg-brand-blue px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-[#0b57cc]"
    >
      {children}
    </button>
  );
}

function SecondaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-full border border-ink/15 px-6 py-3 text-sm font-semibold text-brand-navy transition hover:border-brand-blue hover:text-brand-blue"
    >
      {children}
    </button>
  );
}

// A small looping "in progress" visual for the Building stage — three
// staggered bouncing dots inside a browser-window frame, built entirely
// from Tailwind's built-in animate-bounce (no custom keyframes, no new
// dependency) rather than a real screenshot, since there's nothing real
// to show yet at this stage.
function BuildingAnimation() {
  return (
    <div className="mt-6 flex flex-col items-center gap-4 border-t border-ink/10 pt-6">
      <div className="flex h-14 w-20 flex-col overflow-hidden rounded-md border border-ink/15 bg-paper-alt">
        <div className="flex h-3 items-center gap-1 border-b border-ink/10 px-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-ink/20" />
          <span className="h-1.5 w-1.5 rounded-full bg-ink/20" />
          <span className="h-1.5 w-1.5 rounded-full bg-ink/20" />
        </div>
        <div className="flex flex-1 items-center justify-center gap-1.5">
          <span className="h-2 w-2 animate-bounce rounded-full bg-brand-blue [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-brand-blue [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-brand-blue" />
        </div>
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Building in progress</p>
    </div>
  );
}

// A deliberately abstract, heavily-blurred "coming soon" teaser for the
// presentation stage — never a real screenshot standing in as one (that's
// exactly what this project's no-fabricated-screenshots guardrail
// exists to prevent elsewhere); this is plain CSS shapes, honestly
// presented as a teaser rather than real content.
function BlurredPreview() {
  return (
    <div className="relative mt-6 overflow-hidden border-t border-ink/10 pt-6">
      <div className="pointer-events-none select-none blur-md" aria-hidden="true">
        <div className="h-3 w-2/3 rounded bg-brand-navy/30" />
        <div className="mt-3 h-2 w-full rounded bg-ink/15" />
        <div className="mt-2 h-2 w-5/6 rounded bg-ink/15" />
        <div className="mt-4 h-20 w-full rounded-lg bg-brand-blue/20" />
        <div className="mt-3 flex gap-2">
          <div className="h-6 w-20 rounded-full bg-brand-blue/30" />
          <div className="h-6 w-20 rounded-full bg-ink/10" />
        </div>
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-white/40">
        <p className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-brand-navy">
          Sneak peek &mdash; we don't want to spoil the surprise!
        </p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { me, refresh } = useMe();
  const [chatOpen, setChatOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);

  const stage = me.project?.stage;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Hi {me.client.fullName.split(" ")[0] || "there"}.</h1>
        <p className="mt-1 text-sm text-ink/60">Here's where things stand with {me.client.businessName}.</p>
      </div>

      {stage && !["on_hold", "cancelled", "completed"].includes(stage) && (
        <div className="overflow-x-auto">
          <ProgressRail stage={stage} />
        </div>
      )}

      {!me.project && (
        <Card>
          <p className="text-sm text-ink/60">We're getting your project set up. Check back shortly.</p>
        </Card>
      )}

      {stage === "payment_received" || stage === "account_created" ? (
        <Card>
          <p className="text-sm font-semibold text-brand-blue">Getting Started</p>
          <h2 className="mt-1 text-xl font-bold text-brand-navy">We're setting up your project.</h2>
          <p className="mt-2 max-w-prose text-sm text-ink/60">This only takes a moment. Refresh shortly if this doesn't update.</p>
        </Card>
      ) : null}

      {stage === "discovery" && (
        <Card>
          <p className="text-sm font-semibold text-brand-blue">Discovery</p>
          <h2 className="mt-1 text-xl font-bold text-brand-navy">Talk to Your Developer</h2>
          <p className="mt-2 max-w-prose text-sm text-ink/60">
            Let's learn more about your business so we can build something that actually works for you.
          </p>
          {me.discovery?.scheduledAt && (
            <p className="mt-3 text-sm font-semibold text-brand-navy">{DAY_TIME_FORMATTER.format(new Date(me.discovery.scheduledAt))}</p>
          )}
          {me.discovery?.meetingLink && (
            <p className="mt-1 text-sm">
              <a href={me.discovery.meetingLink} target="_blank" rel="noreferrer" className="text-brand-blue hover:underline">
                Join the call &rarr;
              </a>
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <PrimaryButton onClick={() => setBookingOpen(true)}>
              {me.discovery?.scheduledAt ? "Reschedule Call" : "Schedule a Call"}
            </PrimaryButton>
            <SecondaryButton onClick={() => setChatOpen(true)}>Chat with Your Developer</SecondaryButton>
          </div>
        </Card>
      )}

      {stage === "building" && (
        <Card>
          <p className="text-sm font-semibold text-brand-blue">Building</p>
          <h2 className="mt-1 text-xl font-bold text-brand-navy">We are building your website.</h2>
          <p className="mt-2 max-w-prose text-sm text-ink/60">
            Average build time is 4&ndash;7 days. Once it's built, we'll present it to you.
          </p>
          <BuildingAnimation />
          <div className="mt-5">
            <SecondaryButton onClick={() => setChatOpen(true)}>Chat with Your Developer</SecondaryButton>
          </div>
        </Card>
      )}

      {stage === "ready_for_presentation" && (
        <Card>
          <p className="text-sm font-semibold text-brand-blue">Ready for Presentation</p>
          <h2 className="mt-1 text-xl font-bold text-brand-navy">Your website is ready.</h2>
          <p className="mt-2 max-w-prose text-sm text-ink/60">
            We'll be in touch shortly to set a time to walk through it together.
          </p>
          <div className="mt-5">
            <SecondaryButton onClick={() => setChatOpen(true)}>Chat with Your Developer</SecondaryButton>
          </div>
        </Card>
      )}

      {stage === "presentation" && (
        <Card>
          <p className="text-sm font-semibold text-brand-blue">Presentation</p>
          <h2 className="mt-1 text-xl font-bold text-brand-navy">Your website is ready!</h2>
          {me.presentation?.scheduledAt && (
            <p className="mt-2 max-w-prose text-sm text-ink/60">
              We've scheduled the presentation date on{" "}
              <span className="font-semibold text-brand-navy">{DAY_TIME_FORMATTER.format(new Date(me.presentation.scheduledAt))}</span>.
            </p>
          )}
          {me.presentation?.meetingLink ? (
            <p className="mt-1 text-sm">
              <a href={me.presentation.meetingLink} target="_blank" rel="noreferrer" className="text-brand-blue hover:underline">
                Join the call &rarr;
              </a>
            </p>
          ) : (
            <p className="mt-1 max-w-prose text-sm text-ink/60">We'll send you the meeting link via chat, or you'll see it here once it's set.</p>
          )}
          <BlurredPreview />
          <div className="mt-5">
            <SecondaryButton onClick={() => setChatOpen(true)}>Chat with Your Developer</SecondaryButton>
          </div>
        </Card>
      )}

      {(stage === "post_presentation" || stage === "offer_unlocked" || stage === "conversion" || stage === "essential_upsell") && (
        <Card>
          <p className="text-sm font-semibold text-brand-blue">We're Live!</p>
          <h2 className="mt-1 text-xl font-bold text-brand-navy">Your website is now live!</h2>
          {me.project?.websiteUrl && (
            <p className="mt-2 text-sm">
              <a
                href={ensureAbsoluteUrl(me.project.websiteUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-brand-blue hover:underline"
              >
                {me.project.websiteUrl}
              </a>
            </p>
          )}
          <p className="mt-2 flex items-center gap-2 text-sm text-ink/60">
            <CheckIcon /> Online and up 24/7
          </p>

          {me.offer && (
            <div className="mt-5 border-t border-ink/10 pt-5">
              <h3 className="text-lg font-bold text-brand-navy">
                {typeof me.offer.content?.headline === "string" ? me.offer.content.headline : "A next step for your business"}
              </h3>
              {typeof me.offer.content?.price === "string" && (
                <p className="mt-2 text-2xl font-extrabold text-brand-navy">{me.offer.content.price}</p>
              )}
              {typeof me.offer.content?.body === "string" && <p className="mt-2 max-w-prose text-sm text-ink/60">{me.offer.content.body}</p>}
            </div>
          )}

          <div className="mt-5">
            <p className="text-sm font-semibold text-brand-navy">Got questions?</p>
            <div className="mt-2">
              <SecondaryButton onClick={() => setChatOpen(true)}>Chat with Your Developer</SecondaryButton>
            </div>
          </div>
        </Card>
      )}

      {stage === "on_hold" && (
        <Card>
          <p className="max-w-prose text-sm text-ink/60">Your project is currently on hold. Message us if you'd like to pick things back up.</p>
          <div className="mt-5">
            <SecondaryButton onClick={() => setChatOpen(true)}>Chat with Your Developer</SecondaryButton>
          </div>
        </Card>
      )}

      {stage === "completed" && (
        <Card>
          <p className="text-sm font-semibold text-brand-blue">Completed</p>
          <h2 className="mt-1 text-xl font-bold text-brand-navy">Your project is complete.</h2>
        </Card>
      )}

      <ChatModal open={chatOpen} onClose={() => setChatOpen(false)} />
      <BookingModal
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        alreadyScheduledAt={me.discovery?.scheduledAt ?? null}
        onBooked={refresh}
      />
    </div>
  );
}
