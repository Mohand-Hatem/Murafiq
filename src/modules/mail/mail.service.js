import { Resend } from 'resend';
import env from '../../config/env.config.js';
import { logger } from '../../config/logger.config.js';

// Minimal, temporary mail shim for Phase 1 — Phase 9 replaces this with the full provider-pattern
// implementation (Resend active, SendGrid skeleton) behind the same sendMail({ to, subject, html })
// signature, so nothing calling this needs to change when that happens.
const resend = new Resend(env.RESEND_API_KEY);

const sendMail = async ({ to, subject, html }) => {
  const { data, error } = await resend.emails.send({
    from: env.MAIL_FROM_ADDRESS,
    to,
    subject,
    html,
  });

  if (error) {
    logger.error(`Failed to send email to ${to}: ${error.message}`);
    throw new ApiError(502, 'Failed to send email');
  }

  return data;
};

export default { sendMail };
