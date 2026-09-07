// A URL missing its scheme (e.g. "imago.altasme.com", entered by staff in
// ClientKeeper without "https://") is NOT an absolute URL — an <a href>
// with that value resolves relative to the current page, so it opened at
// https://account.altasme.com/imago.altasme.com instead of
// https://imago.altasme.com (a real bug reported 2026-09-07). This is the
// defensive half of the fix: ClientKeeper's own save endpoint now
// normalizes going forward, but this also self-heals any URL already
// stored without a scheme, without needing a re-save.
export function ensureAbsoluteUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
