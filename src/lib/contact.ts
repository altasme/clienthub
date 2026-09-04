import { CONTACT } from "../content/site";

export const whatsappUrl = (message: string) =>
  `https://wa.me/${CONTACT.whatsapp.number}?text=${encodeURIComponent(message)}`;

export const viberUrl = () => `viber://chat?number=${encodeURIComponent(CONTACT.viber.number)}`;

export const messengerUrl = () => `https://m.me/${CONTACT.messenger.handle}`;
