/**
 * Tiny GA4 wrapper. Safe to call before gtag.js loads (calls become no-ops),
 * and wrapped in try/catch so analytics can never crash the game. Custom
 * events get reported in the Google Analytics → Reports → Events panel and
 * can be promoted to "Key events" there if you want conversion-style stats.
 */

declare global {
  interface Window {
    gtag?: (command: string, eventName: string, params?: Record<string, unknown>) => void;
    dataLayer?: unknown[];
  }
}

export const analytics = {
  event(name: string, params?: Record<string, unknown>): void {
    try {
      window.gtag?.("event", name, params);
    } catch {
      // swallow — analytics must never break gameplay
    }
  },
};
