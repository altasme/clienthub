import { useState } from "react";
import { useMe } from "../lib/MeContext";
import ProgressRail from "../components/ProgressRail";
import ChatModal from "../components/ChatModal";
import BookingModal from "../components/BookingModal";

const DAY_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  weekday: "long",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

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
          <p className="mt-2 text-sm text-ink/60">This only takes a moment. Refresh shortly if this doesn't update.</p>
        </Card>
      ) : null}

      {stage === "discovery" && (
        <Card>
          <p className="text-sm font-semibold text-brand-blue">Discovery</p>
          <h2 className="mt-1 text-xl font-bold text-brand-navy">Talk to Your Developer</h2>
          <p className="mt-2 text-sm text-ink/60">
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
          <h2 className="mt-1 text-xl font-bold text-brand-navy">We're building your website.</h2>
          <p className="mt-2 text-sm text-ink/60">Nothing needed from you right now — we'll let you know when it's ready.</p>
        </Card>
      )}

      {stage === "ready_for_presentation" && (
        <Card>
          <p className="text-sm font-semibold text-brand-blue">Ready for Presentation</p>
          <h2 className="mt-1 text-xl font-bold text-brand-navy">Your website is ready.</h2>
          <p className="mt-2 text-sm text-ink/60">
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
          <h2 className="mt-1 text-xl font-bold text-brand-navy">Your presentation is scheduled.</h2>
          {me.presentation?.scheduledAt && (
            <p className="mt-3 text-sm font-semibold text-brand-navy">{DAY_TIME_FORMATTER.format(new Date(me.presentation.scheduledAt))}</p>
          )}
          {me.presentation?.meetingLink && (
            <p className="mt-1 text-sm">
              <a href={me.presentation.meetingLink} target="_blank" rel="noreferrer" className="text-brand-blue hover:underline">
                Join the call &rarr;
              </a>
            </p>
          )}
          <p className="mt-2 text-sm text-ink/60">Reach out if anything changes.</p>
          <div className="mt-5">
            <SecondaryButton onClick={() => setChatOpen(true)}>Chat with Your Developer</SecondaryButton>
          </div>
        </Card>
      )}

      {(stage === "post_presentation" || stage === "offer_unlocked" || stage === "conversion" || stage === "essential_upsell") && (
        <Card>
          <p className="text-sm font-semibold text-brand-blue">What's Next</p>
          {me.offer ? (
            <>
              <h2 className="mt-1 text-xl font-bold text-brand-navy">
                {typeof me.offer.content?.headline === "string" ? me.offer.content.headline : "A next step for your business"}
              </h2>
              {typeof me.offer.content?.price === "string" && (
                <p className="mt-2 text-2xl font-extrabold text-brand-navy">{me.offer.content.price}</p>
              )}
              {typeof me.offer.content?.body === "string" && <p className="mt-2 text-sm text-ink/60">{me.offer.content.body}</p>}
              <div className="mt-5">
                <SecondaryButton onClick={() => setChatOpen(true)}>Chat with Your Developer</SecondaryButton>
              </div>
            </>
          ) : (
            <>
              <h2 className="mt-1 text-xl font-bold text-brand-navy">What's next?</h2>
              <p className="mt-2 text-sm text-ink/60">We'll reach out with next steps shortly.</p>
              <div className="mt-5">
                <SecondaryButton onClick={() => setChatOpen(true)}>Chat with Your Developer</SecondaryButton>
              </div>
            </>
          )}
        </Card>
      )}

      {stage === "on_hold" && (
        <Card>
          <p className="text-sm text-ink/60">Your project is currently on hold. Message us if you'd like to pick things back up.</p>
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
