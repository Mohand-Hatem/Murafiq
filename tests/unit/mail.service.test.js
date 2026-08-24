import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import env from '../../src/config/env.config.js';
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
