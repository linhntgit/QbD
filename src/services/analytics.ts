// Safe Google Analytics 4 (GA4) Event Dispatcher for QbD Studio™

declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
  }
}

export function trackEvent(eventName: string, params?: Record<string, any>) {
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
