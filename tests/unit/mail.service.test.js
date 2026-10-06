import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import env from '../../src/config/env.config.js';
import logger from '../../src/config/logger.config.js';
import mailService from '../../src/modules/mail/mail.service.js';
import ResendProvider from '../../src/modules/mail/providers/resend.provider.js';
import SendgridProvider from '../../src/modules/mail/providers/sendgrid.provider.js';

describe('Mail Service & Provider Selection Tests', () => {
  const originalProvider = env.MAIL_PROVIDER;

  afterEach(() => {
    env.MAIL_PROVIDER = originalProvider;
    jest.clearAllMocks();
  });

  it('selects ResendProvider by default or when MAIL_PROVIDER is resend', () => {
    env.MAIL_PROVIDER = 'resend';
    const provider = mailService.getProvider();
    expect(provider).toBeInstanceOf(ResendProvider);
  });

  it('selects SendgridProvider when MAIL_PROVIDER is sendgrid', () => {
    env.MAIL_PROVIDER = 'sendgrid';
    const provider = mailService.getProvider();
    expect(provider).toBeInstanceOf(SendgridProvider);
  });

  it('throws 501 Not Implemented when sending via SendgridProvider', async () => {
    env.MAIL_PROVIDER = 'sendgrid';
    await expect(
      mailService.sendMail({
        to: 'test@example.com',
        subject: 'Hello',
        html: '<p>Test</p>',
      })
    ).rejects.toThrow(/SendGrid provider not yet implemented/i);
  });
});

describe('ResendProvider Logging & Privacy Tests', () => {
  let provider;
  let loggerInfoSpy;
  let loggerErrorSpy;

  beforeEach(() => {
    provider = new ResendProvider();
    loggerInfoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends email successfully and logs non-PII success without recipient email', async () => {
    provider.client = {
      emails: {
        send: jest.fn().mockResolvedValue({ data: { id: 'msg_test_123' }, error: null }),
      },
    };

    const recipient = 'confidential.client@example.com';
    const result = await provider.send({
      to: recipient,
      subject: 'Booking Confirmation',
      html: '<p>Confirmed</p>',
    });

    expect(result).toEqual({ id: 'msg_test_123' });
    expect(loggerInfoSpy).toHaveBeenCalledWith('Email sent successfully');

    const allLoggedArgs = [
      ...loggerInfoSpy.mock.calls.flat(),
      ...loggerErrorSpy.mock.calls.flat(),
    ];
    for (const arg of allLoggedArgs) {
      expect(JSON.stringify(arg)).not.toContain(recipient);
    }
  });

  it('handles provider error, throws 502, and logs failure error without recipient email', async () => {
    provider.client = {
      emails: {
        send: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Domain verification required' },
        }),
      },
    };

    const recipient = 'confidential.client@example.com';
    await expect(
      provider.send({
        to: recipient,
        subject: 'Booking Confirmation',
        html: '<p>Confirmed</p>',
      })
    ).rejects.toThrow('Failed to send email. Please try again later.');

    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to send email', {
      error: 'Domain verification required',
    });

    const allLoggedArgs = [
      ...loggerInfoSpy.mock.calls.flat(),
      ...loggerErrorSpy.mock.calls.flat(),
    ];
    for (const arg of allLoggedArgs) {
      expect(JSON.stringify(arg)).not.toContain(recipient);
    }
  });
});
