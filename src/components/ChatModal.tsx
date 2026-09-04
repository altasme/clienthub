import Modal from "./Modal";
import { whatsappUrl, viberUrl, messengerUrl } from "../lib/contact";

const CHAT_PREFILL = "Hi Altaventures! I have a question about my project.";

export default function ChatModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const channels = [
    { label: "WhatsApp", href: whatsappUrl(CHAT_PREFILL) },
    { label: "Messenger", href: messengerUrl() },
    { label: "Viber", href: viberUrl() },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Chat with Your Developer">
      <p className="text-sm text-ink/60">Choose the platform you prefer.</p>
      <div className="mt-4 space-y-2">
        {channels.map((channel) => (
          <a
            key={channel.label}
            href={channel.href}
            target="_blank"
            rel="noopener"
            className="block w-full rounded-xl border border-ink/10 px-4 py-3 text-center text-sm font-semibold text-brand-navy transition hover:border-brand-blue hover:text-brand-blue"
          >
            {channel.label}
          </a>
        ))}
      </div>
    </Modal>
  );
}
