import env from '../../config/env.config.js';
import ResendProvider from './providers/resend.provider.js';
import SendgridProvider from './providers/sendgrid.provider.js';

export const getProvider = () => {
  if (env.MAIL_PROVIDER === 'sendgrid') {
    return new SendgridProvider();
  }
  return new ResendProvider();
};

export const sendMail = async ({ to, subject, html }) => {
  const provider = getProvider();
  return provider.send({ to, subject, html });
};

export default {
  sendMail,
  getProvider,
};
