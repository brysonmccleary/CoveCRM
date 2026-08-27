type MetaPixelWindow = Window & {
  fbq?: ((...args: any[]) => void) & { callMethod?: (...args: any[]) => void; queue?: any[]; loaded?: boolean; version?: string };
  _fbq?: (...args: any[]) => void;
  __coveMetaPixelIds?: Set<string>;
};

export function normalizeMetaPixelId(value: unknown): string {
  const pixelId = String(value || "").trim();
  return /^\d{5,30}$/.test(pixelId) ? pixelId : "";
}

export function initializeMetaPixel(pixelIdInput: unknown): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const pixelId = normalizeMetaPixelId(pixelIdInput);
  if (!pixelId) return false;
  const metaWindow = window as MetaPixelWindow;
  if (!metaWindow.fbq) {
    const fbq: any = function (...args: any[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue.push(args);
    };
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = "2.0";
    metaWindow.fbq = fbq;
    metaWindow._fbq = fbq;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);
  }
  metaWindow.__coveMetaPixelIds ||= new Set<string>();
  if (!metaWindow.__coveMetaPixelIds.has(pixelId)) {
    metaWindow.fbq!("init", pixelId);
    metaWindow.__coveMetaPixelIds.add(pixelId);
  }
  return true;
}

export function trackMetaPageView(pixelId: unknown): boolean {
  if (!initializeMetaPixel(pixelId)) return false;
  (window as MetaPixelWindow).fbq!("track", "PageView");
  return true;
}

export function trackMetaLead(pixelId: unknown, eventId: unknown): boolean {
  const normalizedEventId = String(eventId || "").trim();
  if (!normalizedEventId || !initializeMetaPixel(pixelId)) return false;
  (window as MetaPixelWindow).fbq!("track", "Lead", {}, { eventID: normalizedEventId });
  return true;
}
