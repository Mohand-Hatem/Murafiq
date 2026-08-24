/**
 * Abstract Mail Provider Interface
 */
export class MailProviderInterface {
  async send({ to, subject, html }) { // eslint-disable-line no-unused-vars
    throw new Error('send() must be implemented by mail provider subclass');
  }
}

export default MailProviderInterface;
