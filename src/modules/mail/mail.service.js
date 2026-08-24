import { Resend } from 'resend';
import env from '../../config/env.config.js';
import { logger } from '../../config/logger.config.js';
import ApiError from '../../common/utils/ApiError.js';

// Minimal, temporary mail shim for Phase 1 — Phase 9 replaces this with the full provider-pattern
// implementation (Resend active, SendGrid skeleton) behind the same sendMail({ to, subject, html })
// signature, so nothing calling this needs to change when that happens.
const resend = new Resend(env.RESEND_API_KEY);

const sendMail = async ({ to, subject, html }) => {
  // Dev sandbox workaround: when MAIL_TO_ADDRESS is set, redirect ALL emails
  // to that address and prepend the original recipient in the body.
  const actualRecipient = env.MAIL_TO_ADDRESS || to;
  const actualHtml = env.MAIL_TO_ADDRESS
    ? `<div style="background:#fff3cd;padding:12px;border:1px solid #ffc107;border-radius:6px;margin-bottom:16px;">
        <strong>📧 Dev Mode — Original recipient:</strong> ${to}
       </div>${html}`
    : html;

  const { data, error } = await resend.emails.send({
    from: env.MAIL_FROM_ADDRESS,
    to: actualRecipient,
    subject: env.MAIL_TO_ADDRESS ? `[${to}] ${subject}` : subject,
    html: actualHtml,
  });

  if (error) {
    logger.error(`Failed to send email to ${to}: ${error.message}`);
    throw new ApiError(502, 'Failed to send email. Please try again later.');
  }

  logger.info(`Email sent to ${actualRecipient} (original: ${to})`);
  return data;
};

export default { sendMail };
