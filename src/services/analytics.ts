declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
  }
}

const CONSENT_STORAGE_KEY = 'qbd_analytics_consent';
const GA_MEASUREMENT_ID = 'G-N0R3JNMFDG';

export type ConsentStatus = 'granted' | 'denied' | 'pending';

export function getAnalyticsConsent(): ConsentStatus {
  if (typeof window === 'undefined' || !window.localStorage) return 'denied';
  const val = window.localStorage.getItem(CONSENT_STORAGE_KEY);
  if (val === 'granted' || val === 'denied') return val;
  return 'pending';
}

export function setAnalyticsConsent(status: 'granted' | 'denied'): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.setItem(CONSENT_STORAGE_KEY, status);

  if (typeof window.gtag === 'function') {
    window.gtag('consent', 'update', {
      analytics_storage: status,
      ad_storage: status,
      ad_user_data: status,
      ad_personalization: status,
    });
  }

  if (status === 'granted') {
    ensureGtagScriptLoaded();
  }
}

export function ensureGtagScriptLoaded(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (import.meta.env?.VITE_ENABLE_ANALYTICS === 'false') return;
  if (getAnalyticsConsent() !== 'granted') return;

  const scriptId = 'google-analytics-gtag';
  if (document.getElementById(scriptId)) return;

  const script = document.createElement('script');
  script.id = scriptId;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  if (typeof window.gtag === 'function') {
    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID);
  }
}

export function trackEvent(eventName: string, params?: Record<string, any>) {
  if (getAnalyticsConsent() !== 'granted') return;
  if (import.meta.env?.VITE_ENABLE_ANALYTICS === 'false') return;

  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    try {
      window.gtag('event', eventName, params);
    } catch {
      // Never disrupt application execution if analytics fails
    }
  }
}

export function trackTabChange(tabKey: string) {
  trackEvent('qbd_tab_view', {
    tab_name: tabKey,
    event_category: 'Navigation',
  });
}

export function trackProjectAction(action: 'new' | 'load' | 'save_json' | 'export_word') {
  trackEvent(`qbd_project_${action}`, {
    event_category: 'Project Management',
  });
}

export function trackModelAction(engine: 'polynomial' | 'neural', action: string, details?: Record<string, any>) {
  trackEvent(`qbd_model_${action}`, {
    modeling_engine: engine,
    event_category: 'Modeling Engine',
    ...details,
  });
}
