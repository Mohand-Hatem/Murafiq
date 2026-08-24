import { Buffer } from 'buffer';
import uploadService from '../../src/modules/uploads/upload.service.js';

describe('Upload Service', () => {
  it('rejects upload to an unapproved folder', async () => {
    await expect(
      uploadService.uploadFile({ id: 'u1' }, 'forbidden-folder', { buffer: Buffer.from('test') })
    ).rejects.toThrow(/Invalid upload folder/i);
  });

  it('rejects upload when file buffer is missing', async () => {
    await expect(
      uploadService.uploadFile({ id: 'u1' }, 'avatars', null)
    ).rejects.toThrow(/No file provided/i);
  });

  it('generates signed KYC url for authenticated documents', () => {
    const signedUrl = uploadService.getSignedKycUrl('murafiq/kyc-documents/sample_id');
    expect(signedUrl).toBeDefined();
    expect(typeof signedUrl).toBe('string');
  });
});
