const COLLECT_URL = '/api/v1/analytics/collect';
const VISITOR_ID_KEY = 'huaovo-vid';
const VALID_VISITOR_ID = /^[a-zA-Z0-9_-]{12,64}$/;

export function getOrCreateVisitorId(storage, randomId = () => globalThis.crypto?.randomUUID?.()) {
  try {
    const existing = storage?.getItem?.(VISITOR_ID_KEY);
    if (existing && VALID_VISITOR_ID.test(existing)) return existing;
    const generated = String(randomId() || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    const id = VALID_VISITOR_ID.test(generated)
      ? generated
      : `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    storage?.setItem?.(VISITOR_ID_KEY, id);
    return id;
  } catch {
    const generated = String(randomId() || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    return VALID_VISITOR_ID.test(generated) ? generated : '';
  }
}

export function extractReferrer(rawReferrer, currentOrigin = '') {
  if (!rawReferrer) return '';
  try {
    const parsed = new URL(String(rawReferrer));
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    if (currentOrigin && parsed.origin === currentOrigin) return 'internal';
    return parsed.hostname.replace(/^www\./i, '').toLowerCase().slice(0, 120);
  } catch {
    return '';
  }
}

export function createEngagementTracker({
  targetType,
  targetKey,
  visitorId = '',
  referrer = '',
  now = () => Date.now(),
  isVisible = () => true,
  hasReachedEnd = () => false,
  send,
  idleLimitMs = 60_000,
  minReadForCompletionMs = 5_000,
}) {
  let activeSince = null;
  let accumulatedMs = 0;
  let lastInteractionAt = now();
  let reportedSeconds = 0;
  let reportedCompleted = false;
  let viewSent = false;

  function flushClock(timestamp = now()) {
    if (activeSince === null) return;
    const effectiveEnd = Math.min(timestamp, lastInteractionAt + idleLimitMs);
    if (effectiveEnd > activeSince) accumulatedMs += effectiveEnd - activeSince;
    activeSince = timestamp - lastInteractionAt < idleLimitMs && isVisible() ? timestamp : null;
  }

  function flushReport({ preferBeacon = false, timestamp = now() } = {}) {
    if (targetType !== 'post') return false;
    flushClock(timestamp);
    const totalSeconds = Math.floor(accumulatedMs / 1000);
    const delta = Math.max(0, totalSeconds - reportedSeconds);
    const completed = !reportedCompleted && hasReachedEnd() && accumulatedMs >= minReadForCompletionMs;
    if (delta < 2 && !completed) return false;
    reportedSeconds += delta;
    if (completed) reportedCompleted = true;
    send({
      type: 'engage',
      targetType: 'post',
      targetKey,
      ...(visitorId ? { visitorId } : {}),
      durationDelta: delta,
      completed,
    }, { preferBeacon });
    return true;
  }

  return {
    start() {
      if (!viewSent) {
        viewSent = true;
        send({
          type: 'view',
          targetType,
          targetKey,
          ...(visitorId ? { visitorId } : {}),
          ...(referrer ? { referrer } : {}),
        }, { preferBeacon: false });
      }
      if (targetType === 'post' && isVisible()) {
        const timestamp = now();
        lastInteractionAt = timestamp;
        activeSince = timestamp;
      }
    },
    onInteraction(timestamp = now()) {
      if (targetType !== 'post') return;
      flushClock(timestamp);
      lastInteractionAt = timestamp;
      if (isVisible()) activeSince = timestamp;
      if (!reportedCompleted && hasReachedEnd() && accumulatedMs >= minReadForCompletionMs) {
        flushReport({ preferBeacon: false, timestamp });
      }
    },
    onVisibilityChange(timestamp = now()) {
      if (targetType !== 'post') return;
      flushClock(timestamp);
      if (isVisible()) {
        lastInteractionAt = timestamp;
        activeSince = timestamp;
      } else {
        activeSince = null;
        flushReport({ preferBeacon: true, timestamp });
      }
    },
    tick(timestamp = now()) {
      if (targetType !== 'post') return;
      flushClock(timestamp);
      const totalSeconds = Math.floor(accumulatedMs / 1000);
      if ((!reportedCompleted && hasReachedEnd() && accumulatedMs >= minReadForCompletionMs) || totalSeconds - reportedSeconds >= 15) {
        flushReport({ preferBeacon: false, timestamp });
      }
    },
    onUnload(timestamp = now()) {
      if (targetType !== 'post') return;
      flushClock(timestamp);
      activeSince = null;
      flushReport({ preferBeacon: true, timestamp });
    },
    snapshot() {
      return { accumulatedMs, reportedSeconds, reportedCompleted, active: activeSince !== null };
    },
  };
}

export function startReadingTracker() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || navigator.webdriver) return;
  const { analyticsType, analyticsKey } = document.body?.dataset || {};
  if (!analyticsType || !analyticsKey) return;

  function send(payload, { preferBeacon } = {}) {
    const body = JSON.stringify(payload);
    if (preferBeacon && typeof navigator.sendBeacon === 'function') {
      try {
        if (navigator.sendBeacon(COLLECT_URL, new Blob([body], { type: 'application/json' }))) return;
      } catch {
        // Fallback to keepalive fetch when Beacon fails.
      }
    }
    fetch(COLLECT_URL, {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {});
  }

  const visitorId = getOrCreateVisitorId(window.localStorage);
  const referrer = extractReferrer(document.referrer, window.location.origin);

  const tracker = createEngagementTracker({
    targetType: analyticsType,
    targetKey: analyticsKey,
    visitorId,
    referrer,
    isVisible: () => document.visibilityState === 'visible',
    hasReachedEnd: () => {
      const article = document.querySelector('article.article-prose');
      if (!article) return false;
      const rect = article.getBoundingClientRect();
      return rect.height > 0 && rect.bottom <= window.innerHeight + 80;
    },
    send,
  });

  tracker.start();
  if (analyticsType !== 'post') return;

  let lastTouch = 0;
  const interact = () => {
    const current = Date.now();
    if (current - lastTouch < 500) return;
    lastTouch = current;
    tracker.onInteraction(current);
  };
  const onVisibility = () => tracker.onVisibilityChange(Date.now());
  const timer = window.setInterval(() => tracker.tick(Date.now()), 10_000);
  const onPageHide = () => {
    window.clearInterval(timer);
    tracker.onUnload(Date.now());
  };

  for (const eventName of ['scroll', 'pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(eventName, interact, { passive: true });
  }
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide, { once: true });
}
