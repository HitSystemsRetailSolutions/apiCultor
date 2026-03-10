import { getAzureSASTokenService } from './azureSASToken.service';
import { generateBlobSASQueryParameters, StorageSharedKeyCredential, BlobSASPermissions } from '@azure/storage-blob';

jest.mock('@azure/storage-blob', () => ({
  StorageSharedKeyCredential: jest.fn(),
  BlobSASPermissions: { parse: jest.fn().mockReturnValue('rwcm') },
  SASProtocol: { Https: 'https' },
  generateBlobSASQueryParameters: jest.fn().mockReturnValue({ toString: () => 'sv=2024&sig=test' }),
}));

describe('getAzureSASTokenService', () => {
  let service: getAzureSASTokenService;

  beforeEach(() => {
    service = new getAzureSASTokenService();
    jest.clearAllMocks();

    process.env.AZURE_STORAGE_ACCOUNT = 'teststorage';
    process.env.AZURE_STORAGE_KEY = 'dGVzdGtleQ==';
  });

  describe('generateSasUrl', () => {
    it('should generate container-level SAS URL when no blobName', async () => {
      const url = await service.generateSasUrl();

      expect(url).toBe('https://teststorage.blob.core.windows.net/tickets?sv=2024&sig=test');
      expect(generateBlobSASQueryParameters).toHaveBeenCalled();
      expect(StorageSharedKeyCredential).toHaveBeenCalledWith('teststorage', 'dGVzdGtleQ==');
    });

    it('should generate blob-level SAS URL when blobName is provided', async () => {
      const url = await service.generateSasUrl('ticket-001.csv');

      expect(url).toBe('https://teststorage.blob.core.windows.net/tickets/ticket-001.csv?sv=2024&sig=test');
    });

    it('should use correct permissions (rwcm)', async () => {
      await service.generateSasUrl();

      expect(BlobSASPermissions.parse).toHaveBeenCalledWith('rwcm');
    });

    it('should pass container name as tickets', async () => {
      await service.generateSasUrl();

      const callArgs = (generateBlobSASQueryParameters as jest.Mock).mock.calls[0][0];
      expect(callArgs.containerName).toBe('tickets');
    });

    it('should set expiry based on expiresInHours param', async () => {
      const before = new Date();
      await service.generateSasUrl(undefined, 5);
      const after = new Date();

      const callArgs = (generateBlobSASQueryParameters as jest.Mock).mock.calls[0][0];
      const expiry = callArgs.expiresOn as Date;

      // Expiry should be approximately 5 hours from now
      const expectedMin = new Date(before.getTime() + 5 * 60 * 60 * 1000 - 5000);
      const expectedMax = new Date(after.getTime() + 5 * 60 * 60 * 1000 + 5000);
      expect(expiry.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime());
      expect(expiry.getTime()).toBeLessThanOrEqual(expectedMax.getTime());
    });
  });
});
