import { getTokenService } from './getToken.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('getTokenService', () => {
  let service: getTokenService;

  beforeEach(() => {
    service = new getTokenService();
    jest.clearAllMocks();

    process.env.tenant = 'test-tenant';
    process.env.token_type = 'Bearer';
    process.env.grant_type = 'client_credentials';
    process.env.client_id = 'test-client-id';
    process.env.client_secret = 'test-client-secret';
    process.env.scope = 'https://api.businesscentral.dynamics.com/.default';
  });

  describe('getToken', () => {
    it('should return access token on success', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: 'test-token-123' },
      });

      const token = await service.getToken();

      expect(token).toBe('test-token-123');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://login.microsoftonline.com/test-tenant/oauth2/v2.0/token',
        expect.any(URLSearchParams),
      );
    });

    it('should send correct params', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: 'token' },
      });

      await service.getToken();

      const params = mockedAxios.post.mock.calls[0][1] as URLSearchParams;
      expect(params.get('tenant')).toBe('test-tenant');
      expect(params.get('grant_type')).toBe('client_credentials');
      expect(params.get('client_id')).toBe('test-client-id');
      expect(params.get('client_secret')).toBe('test-client-secret');
    });

    it('should throw when response has no data', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: null });

      await expect(service.getToken()).rejects.toThrow('Failed to obtain access token');
    });

    it('should throw on network error', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Network Error'));

      await expect(service.getToken()).rejects.toThrow();
    });
  });

  describe('getToken2', () => {
    it('should return access token with custom credentials', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: 'custom-token-456' },
      });

      const token = await service.getToken2('custom-id', 'custom-secret', 'custom-tenant');

      expect(token).toBe('custom-token-456');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://login.microsoftonline.com/custom-tenant/oauth2/v2.0/token',
        expect.any(URLSearchParams),
      );
    });

    it('should use custom client_id and client_secret', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: 'token' },
      });

      await service.getToken2('my-id', 'my-secret', 'my-tenant');

      const params = mockedAxios.post.mock.calls[0][1] as URLSearchParams;
      expect(params.get('client_id')).toBe('my-id');
      expect(params.get('client_secret')).toBe('my-secret');
      expect(params.get('tenant')).toBe('my-tenant');
    });

    it('should throw when response has no data', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: null });

      await expect(service.getToken2('id', 'secret', 'tenant')).rejects.toThrow(
        'Failed to obtain access token',
      );
    });
  });
});
