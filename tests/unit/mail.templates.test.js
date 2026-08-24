import {
  welcomeTemplate,
  otpTemplate,
  verifyEmailTemplate,
  forgotPasswordTemplate,
  bookingConfirmationTemplate,
} from '../../src/modules/mail/templates/index.js';

describe('Mail Templates Unit Tests', () => {
  it('renders welcomeTemplate with user name', () => {
    const result = welcomeTemplate({ name: 'Sara' });
    expect(result.subject).toBe('Welcome to Murafiq!');
    expect(result.html).toContain('Welcome to Murafiq Sara!');
    expect(result.html).toContain('The Murafiq Team');
  });

  it('renders welcomeTemplate without name gracefully', () => {
    const result = welcomeTemplate({});
    expect(result.subject).toBe('Welcome to Murafiq!');
    expect(result.html).toContain('Welcome to Murafiq!');
  });

  it('renders otpTemplate with OTP code and name', () => {
    const result = otpTemplate({ name: 'Ahmed', otp: '123456' });
    expect(result.subject).toBe('Your Murafiq verification code');
    expect(result.html).toContain('Hello Ahmed');
    expect(result.html).toContain('123456');
    expect(result.html).toContain('expire in 10 minutes');
  });

  it('renders verifyEmailTemplate with verificationUrl', () => {
    const result = verifyEmailTemplate({
      name: 'Mohamed',
      otp: '654321',
      verificationUrl: 'https://murafiq.com/verify?token=xyz',
    });
    expect(result.subject).toBe('Verify your Murafiq account');
    expect(result.html).toContain('Hello Mohamed');
    expect(result.html).toContain('654321');
    expect(result.html).toContain('https://murafiq.com/verify?token=xyz');
  });

  it('renders forgotPasswordTemplate with resetUrl', () => {
    const result = forgotPasswordTemplate({
      name: 'Layla',
      otp: '998877',
      resetUrl: 'https://murafiq.com/reset?token=abc',
    });
    expect(result.subject).toBe('Reset your Murafiq password');
    expect(result.html).toContain('Hello Layla');
    expect(result.html).toContain('998877');
    expect(result.html).toContain('https://murafiq.com/reset?token=abc');
  });

  it('renders bookingConfirmationTemplate with details', () => {
    const result = bookingConfirmationTemplate({
      clientName: 'Nour',
      stylistName: 'Karim',
      scheduledDate: '2026-09-01',
      startTime: '14:00',
      location: 'Mall of Arabia, Cairo',
      price: 1500,
    });
    expect(result.subject).toBe('Booking Confirmation — Murafiq');
    expect(result.html).toContain('Hello Nour');
    expect(result.html).toContain('Karim');
    expect(result.html).toContain('2026-09-01');
    expect(result.html).toContain('14:00');
    expect(result.html).toContain('Mall of Arabia, Cairo');
    expect(result.html).toContain('1500 EGP');
  });
});
