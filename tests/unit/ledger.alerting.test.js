import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import { dispatchReconciliationAlert } from '../../src/jobs/ledger-reconciliation.cron.js';
import mailService from '../../src/modules/mail/mail.service.js';
import env from '../../src/config/env.config.js';
import { logger } from '../../src/config/logger.config.js';

describe('Ledger Reconciliation Alerting (OBS-04)', () => {
  const originalAlertEmail = env.ALERT_EMAIL;
  const originalAlertWebhookUrl = env.ALERT_WEBHOOK_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    env.ALERT_EMAIL = originalAlertEmail;
    env.ALERT_WEBHOOK_URL = originalAlertWebhookUrl;
    jest.restoreAllMocks();
  });

  it('warns when imbalance is detected but neither ALERT_EMAIL nor ALERT_WEBHOOK_URL is configured', async () => {
    delete env.ALERT_EMAIL;
    delete env.ALERT_WEBHOOK_URL;

    const summary = { checkedBookings: 10, unbalancedCount: 1, missingLedgerCount: 0 };
    await dispatchReconciliationAlert(summary);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Imbalance detected but no ALERT_EMAIL or ALERT_WEBHOOK_URL configured')
    );
  });

  it('sends email when ALERT_EMAIL is configured', async () => {
    env.ALERT_EMAIL = 'finance-alerts@example.com';
    delete env.ALERT_WEBHOOK_URL;

    jest.spyOn(mailService, 'sendMail').mockResolvedValue(true);

    const summary = { checkedBookings: 5, unbalancedCount: 1, missingLedgerCount: 2 };
    await dispatchReconciliationAlert(summary);

    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'finance-alerts@example.com',
        subject: expect.stringContaining('Ledger Reconciliation Failure Detected'),
        html: expect.stringContaining('Unbalanced Transactions:</strong> 1'),
      })
    );
  });

  it('sends POST request to ALERT_WEBHOOK_URL when configured', async () => {
    delete env.ALERT_EMAIL;
    env.ALERT_WEBHOOK_URL = 'https://alerts.example.com/reconciliation';

    const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const summary = { checkedBookings: 8, unbalancedCount: 2, missingLedgerCount: 0 };
      await dispatchReconciliationAlert(summary);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://alerts.example.com/reconciliation',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('LEDGER_RECONCILIATION_FAILED'),
        })
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('logs warning if webhook returns non-200 without throwing', async () => {
    delete env.ALERT_EMAIL;
    env.ALERT_WEBHOOK_URL = 'https://alerts.example.com/reconciliation';

    const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const summary = { checkedBookings: 8, unbalancedCount: 2, missingLedgerCount: 0 };
      await expect(dispatchReconciliationAlert(summary)).resolves.not.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Alert webhook returned HTTP 500')
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('isolates failures if mailService throws', async () => {
    env.ALERT_EMAIL = 'finance-alerts@example.com';
    delete env.ALERT_WEBHOOK_URL;

    jest.spyOn(mailService, 'sendMail').mockRejectedValue(new Error('SMTP connection timed out'));

    const summary = { checkedBookings: 5, unbalancedCount: 1, missingLedgerCount: 0 };
    await expect(dispatchReconciliationAlert(summary)).resolves.not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to dispatch alert: SMTP connection timed out')
    );
  });
});
