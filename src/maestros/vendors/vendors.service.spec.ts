import { vendorsService } from './vendors.service';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import { helpersService } from 'src/helpers/helpers.service';
import axios from 'axios';

jest.mock('axios');
jest.mock('mqtt', () => ({
  connect: jest.fn().mockReturnValue({
    publish: jest.fn(),
    on: jest.fn(),
    subscribe: jest.fn(),
  }),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('vendorsService', () => {
  let service: vendorsService;
  let tokenService: jest.Mocked<getTokenService>;
  let sqlService: jest.Mocked<runSqlService>;
  let helpers: helpersService;

  beforeEach(() => {
    tokenService = {
      getToken: jest.fn().mockResolvedValue('test-token'),
      getToken2: jest.fn().mockResolvedValue('test-token'),
    } as any;

    sqlService = {
      runSql: jest.fn(),
      PoolCreation: jest.fn(),
    } as any;

    helpers = new helpersService();

    service = new vendorsService(tokenService, sqlService, helpers);
    jest.clearAllMocks();

    process.env.baseURL = 'https://api.businesscentral.dynamics.com';
    process.env.tenaTenant = 'blocked-tenant';

    // Re-mock after clearAllMocks
    tokenService.getToken2.mockResolvedValue('test-token');
  });

  describe('sanitizePhone', () => {
    it('should clean phone numbers', () => {
      expect(service.sanitizePhone('934 567 890')).toBe('934 567 890');
      expect(service.sanitizePhone('+34 934567890')).toBe('+34 934567890');
      expect(service.sanitizePhone('')).toBe('');
      expect(service.sanitizePhone(null)).toBe('');
      expect(service.sanitizePhone('abc123def')).toBe('123');
    });
  });

  describe('sanitizeIBAN', () => {
    it('should clean IBAN removing non-alphanumeric chars', () => {
      expect(service.sanitizeIBAN('ES12 3456 7890 1234 5678 9012')).toBe('ES1234567890123456789012');
      expect(service.sanitizeIBAN('es12-3456-7890')).toBe('ES1234567890');
      expect(service.sanitizeIBAN('')).toBe('');
      expect(service.sanitizeIBAN(null)).toBe('');
    });
  });

  describe('getPaymentMethodId', () => {
    it('should return payment method ID when found', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { value: [{ id: 'pm-123' }] },
      });

      const result = await service.getPaymentMethodId('EFECTIVO', 'company1', 'cid', 'cs', 'tenant', 'production');

      expect(result).toBe('pm-123');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('paymentMethods'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );
    });

    it('should return empty string when not found', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { value: [] },
      });

      const result = await service.getPaymentMethodId('UNKNOWN', 'company1', 'cid', 'cs', 'tenant', 'production');

      expect(result).toBe('');
    });
  });

  describe('getPaymentTermId', () => {
    it('should return existing payment term ID', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { value: [{ id: 'pt-789' }] },
      });

      const result = await service.getPaymentTermId('30 DÍAS', 'company1', 'cid', 'cs', 'tenant', 'production');

      expect(result).toBe('pt-789');
    });

    it('should create payment term if not found with days', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { value: [] },
      });
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 'pt-new' },
      });

      const result = await service.getPaymentTermId('60 DÍAS', 'company1', 'cid', 'cs', 'tenant', 'production');

      expect(result).toBe('pt-new');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('paymentTerms'),
        expect.objectContaining({
          code: '60 DÍAS',
          dueDateCalculation: '60D',
        }),
        expect.any(Object),
      );
    });

    it('should handle CON payment term', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { value: [] } });
      mockedAxios.post.mockResolvedValueOnce({ data: { id: 'pt-con' } });

      await service.getPaymentTermId('CON', 'company1', 'cid', 'cs', 'tenant', 'production');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          dueDateCalculation: '0D',
        }),
        expect.any(Object),
      );
    });
  });

  describe('syncVendors', () => {
    it('should skip if tenant is blocked', async () => {
      const result = await service.syncVendors('comp1', 'db', 'cid', 'cs', 'blocked-tenant', 'prod');

      expect(sqlService.runSql).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('should return false when no vendors found', async () => {
      sqlService.runSql.mockResolvedValueOnce({ recordset: [] });

      const result = await service.syncVendors('comp1', 'db', 'cid', 'cs', 'tenant', 'prod');

      expect(result).toBe(false);
    });

    it('should throw when no vendors found with codiHIT', async () => {
      sqlService.runSql.mockResolvedValueOnce({ recordset: [] });

      await expect(
        service.syncVendors('comp1', 'db', 'cid', 'cs', 'tenant', 'prod', '12345678A'),
      ).rejects.toThrow('No se encontraron registros de proveedores');
    });
  });
});
