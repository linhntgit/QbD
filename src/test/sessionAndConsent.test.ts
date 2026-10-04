import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getActiveSession,
  setActiveSession,
  getAuditUserFromSession,
  signWithWebCryptoECDSA,
} from '../services/sessionService';
import {
  getAnalyticsConsent,
  setAnalyticsConsent,
  trackEvent,
  trackTabChange,
  trackProjectAction,
  trackModelAction,
} from '../services/analytics';
import {
  exportFullDoECSV,
  exportTemplateCSV,
  exportToExcel,
  exportTemplateExcel,
} from '../services/doeExcelService';

describe('Phase P2: User Session & Identity Management (sessionService)', () => {
  let memoryStore: Record<string, string> = {};

  beforeEach(() => {
    memoryStore = {};
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => memoryStore[key] ?? null,
        setItem: (key: string, value: string) => {
          memoryStore[key] = value;
        },
        removeItem: (key: string) => {
          delete memoryStore[key];
        },
        clear: () => {
          memoryStore = {};
        },
      },
      crypto: globalThis.crypto,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns default active session when no stored session exists', () => {
    const session = getActiveSession();
    expect(session.name).toBe('Tran Linh Nguyen');
    expect(session.role).toBe('Analyst');
    expect(session.department).toBe('Phòng Bào Chế & R&D');
    expect(session.loginTime).toBeDefined();
  });

  it('updates session and persists to localStorage', () => {
    const updated = setActiveSession({
      name: 'Nguyen Van A',
      role: 'Reviewer',
      department: 'Phòng Đảm Bảo Chất Lượng (QA)',
    });

    expect(updated.name).toBe('Nguyen Van A');
    expect(updated.role).toBe('Reviewer');
    expect(updated.department).toBe('Phòng Đảm Bảo Chất Lượng (QA)');

    const reloaded = getActiveSession();
    expect(reloaded.name).toBe('Nguyen Van A');
    expect(reloaded.role).toBe('Reviewer');
    expect(reloaded.department).toBe('Phòng Đảm Bảo Chất Lượng (QA)');
  });

  it('provides AuditUser format for projectGovernance integration', () => {
    setActiveSession({
      name: 'Dr. Pharmacist',
      role: 'Approver',
      department: 'Hội Đồng Khoa Học',
    });

    const auditUser = getAuditUserFromSession();
    expect(auditUser).toEqual({
      name: 'Dr. Pharmacist',
      role: 'Approver',
      department: 'Hội Đồng Khoa Học',
    });
  });

  it('signs payload using WebCrypto ECDSA keypair', async () => {
    if (globalThis.crypto?.subtle) {
      const payload = 'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2';
      const result = await signWithWebCryptoECDSA(payload);

      expect(result).not.toBeNull();
      expect(result?.signatureHex).toBeDefined();
      expect(typeof result?.signatureHex).toBe('string');
      expect(result?.signatureHex.length).toBeGreaterThan(64);
      expect(result?.publicKeyHex).toBeDefined();
      expect(result?.publicKeyHex.length).toBeGreaterThan(64);
    }
  });
});

describe('Phase P2: Privacy & Google Consent Mode v2 (analytics)', () => {
  let memoryStore: Record<string, string> = {};
  let gtagCalls: Array<{ command: string; args: any[] }> = [];

  beforeEach(() => {
    memoryStore = {};
    gtagCalls = [];

    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => memoryStore[key] ?? null,
        setItem: (key: string, value: string) => {
          memoryStore[key] = value;
        },
        removeItem: (key: string) => {
          delete memoryStore[key];
        },
        clear: () => {
          memoryStore = {};
        },
      },
      gtag: (command: string, ...args: any[]) => {
        gtagCalls.push({ command, args });
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to pending consent when unconfigured', () => {
    expect(getAnalyticsConsent()).toBe('pending');
  });

  it('updates consent and notifies gtag', () => {
    setAnalyticsConsent('granted');
    expect(getAnalyticsConsent()).toBe('granted');
    expect(memoryStore['qbd_analytics_consent']).toBe('granted');

    const updateCall = gtagCalls.find(
      (c) => c.command === 'consent' && c.args[0] === 'update'
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.args[1]).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    });

    setAnalyticsConsent('denied');
    expect(getAnalyticsConsent()).toBe('denied');
    expect(memoryStore['qbd_analytics_consent']).toBe('denied');
  });

  it('suppresses tracking events when consent is pending or denied', () => {
    gtagCalls = [];
    trackEvent('test_event', { foo: 'bar' });
    trackTabChange('doe_designer');
    trackProjectAction('save_json');
    trackModelAction('polynomial', 'train');

    const eventCalls = gtagCalls.filter((c) => c.command === 'event');
    expect(eventCalls.length).toBe(0);

    setAnalyticsConsent('denied');
    trackEvent('test_event_2');
    const deniedEventCalls = gtagCalls.filter((c) => c.command === 'event');
    expect(deniedEventCalls.length).toBe(0);
  });

  it('allows tracking events when consent is granted', () => {
    setAnalyticsConsent('granted');
    gtagCalls = [];

    trackEvent('test_allowed_event', { step: 1 });
    trackTabChange('design_space');
    trackProjectAction('export_word');
    trackModelAction('neural', 'benchmark');

    const eventCalls = gtagCalls.filter((c) => c.command === 'event');
    expect(eventCalls.length).toBe(4);
    expect(eventCalls[0].args[0]).toBe('test_allowed_event');
    expect(eventCalls[1].args[0]).toBe('qbd_tab_view');
    expect(eventCalls[2].args[0]).toBe('qbd_project_export_word');
    expect(eventCalls[3].args[0]).toBe('qbd_model_benchmark');
  });
});

describe('Phase P2: CSV Export Function Disambiguation (doeExcelService)', () => {
  it('exports primary CSV functions and maintains backward-compatible aliases', () => {
    expect(typeof exportFullDoECSV).toBe('function');
    expect(typeof exportTemplateCSV).toBe('function');
    expect(exportToExcel).toBe(exportFullDoECSV);
    expect(exportTemplateExcel).toBe(exportTemplateCSV);
  });
});
