import MailProviderInterface from './mail-provider.interface.js';

export class SendgridProvider extends MailProviderInterface {
  async send({ to, subject, html }) { // eslint-disable-line no-unused-vars
    throw new ApiError(501, 'SendGrid provider not yet implemented');
  }
}

export default SendgridProvider;
