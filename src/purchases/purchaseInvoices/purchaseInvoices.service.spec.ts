import { purchaseInvoicesService } from './purchaseInvoices.service';
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

describe('purchaseInvoicesService', () => {
  let service: purchaseInvoicesService;
  let tokenService: jest.Mocked<getTokenService>;
  let sqlService: jest.Mocked<runSqlService>;
  let helpers: helpersService;

  const companyID = 'company-123';
  const database = 'testdb';
  const client_id = 'cid';
  const client_secret = 'cs';
  const tenant = 'test-tenant';
  const entorno = 'production';

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

    service = new purchaseInvoicesService(tokenService, sqlService, helpers);
    jest.clearAllMocks();

    process.env.baseURL = 'https://api.businesscentral.dynamics.com';
    process.env.tenaTenant = 'blocked-tenant';

    // Re-mock after clearAllMocks
    tokenService.getToken2.mockResolvedValue('test-token');
  });

  describe('syncPurchaseInvoices', () => {
    it('should skip if tenant is blocked', async () => {
      const result = await service.syncPurchaseInvoices(companyID, database, client_id, client_secret, 'blocked-tenant', entorno);

      expect(sqlService.runSql).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when no invoices found', async () => {
      sqlService.runSql.mockResolvedValueOnce({ recordset: [] });

      const result = await service.syncPurchaseInvoices(companyID, database, client_id, client_secret, tenant, entorno);

      expect(result).toBe(false);
    });

    it('should create a new purchase invoice in BC', async () => {
      const invoiceDate = new Date('2024-03-15');
      sqlService.runSql
        .mockResolvedValueOnce({
          recordset: [{
            NumFactura: 'FR001',
            DataFactura: invoiceDate,
            NifProveidor: 'B12345678',
            NomProveidor: 'Proveedor Test',
            BaseImposable: 100.00,
            TipoIva: 21,
            ImportIva: 21.00,
            Total: 121.00,
            SerieFactura: 'A',
            DataRegistre: new Date('2024-03-16'),
          }],
        });

      // getOrCreateVendor - vendor exists
      mockedAxios.get.mockResolvedValueOnce({
        data: { value: [{ number: 'B12345678' }] },
      });

      // Create purchase invoice
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 'pi-001', number: 'PI-001' },
      });

      // Create purchase invoice line
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 'line-001' },
      });

      // Update SQL BC_Sync
      sqlService.runSql.mockResolvedValueOnce({});

      const result = await service.syncPurchaseInvoices(companyID, database, client_id, client_secret, tenant, entorno);

      expect(result).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('purchaseInvoices'),
        expect.objectContaining({
          vendorNumber: 'B12345678',
          invoiceDate: '2024-03-15',
          vendorInvoiceNumber: 'AFR001',
        }),
        expect.any(Object),
      );
    });

    it('should mark invoice as synced in SQL after creation', async () => {
      const invoiceDate = new Date('2024-03-15');
      sqlService.runSql
        .mockResolvedValueOnce({
          recordset: [{
            NumFactura: 'FR002',
            DataFactura: invoiceDate,
            NifProveidor: 'A98765432',
            NomProveidor: 'Proveedor 2',
            BaseImposable: 200.00,
            TipoIva: 21,
            ImportIva: 42.00,
            Total: 242.00,
            SerieFactura: '',
            DataRegistre: invoiceDate,
          }],
        });

      // getOrCreateVendor
      mockedAxios.get.mockResolvedValueOnce({
        data: { value: [{ number: 'A98765432' }] },
      });

      // Create purchase invoice
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 'pi-002' },
      });

      // Create line
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 'line-002' },
      });

      // Update SQL
      sqlService.runSql.mockResolvedValueOnce({});

      await service.syncPurchaseInvoices(companyID, database, client_id, client_secret, tenant, entorno);

      // Second runSql call is the UPDATE
      expect(sqlService.runSql).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE FacturesRebudes SET BC_Sync=1"),
        database,
      );
      expect(sqlService.runSql).toHaveBeenCalledWith(
        expect.stringContaining("BC_IdPurchase='pi-002'"),
        database,
      );
    });

    it('should handle API errors when creating invoice and continue', async () => {
      sqlService.runSql
        .mockResolvedValueOnce({
          recordset: [{
            NumFactura: 'FR003',
            DataFactura: new Date('2024-01-01'),
            NifProveidor: 'C11111111',
            NomProveidor: 'Proveedor Error',
            BaseImposable: 50.00,
            TipoIva: 21,
            ImportIva: 10.50,
            Total: 60.50,
            SerieFactura: '',
            DataRegistre: new Date('2024-01-01'),
          }],
        });

      // getOrCreateVendor
      mockedAxios.get.mockResolvedValueOnce({
        data: { value: [{ number: 'C11111111' }] },
      });

      // Create purchase invoice fails
      mockedAxios.post.mockRejectedValueOnce(new Error('BC API Error'));

      const result = await service.syncPurchaseInvoices(companyID, database, client_id, client_secret, tenant, entorno);

      // Should still return true (processed all invoices, even if some failed)
      expect(result).toBe(true);
    });

    it('should handle vendor creation when vendor does not exist', async () => {
      sqlService.runSql
        .mockResolvedValueOnce({
          recordset: [{
            NumFactura: 'FR004',
            DataFactura: new Date('2024-02-01'),
            NifProveidor: 'D22222222',
            NomProveidor: 'Nuevo Proveedor',
            BaseImposable: 300.00,
            TipoIva: 21,
            ImportIva: 63.00,
            Total: 363.00,
            SerieFactura: 'B',
            DataRegistre: new Date('2024-02-01'),
          }],
        });

      // getOrCreateVendor - vendor does NOT exist
      mockedAxios.get.mockResolvedValueOnce({
        data: { value: [] },
      });

      // Create vendor
      mockedAxios.post.mockResolvedValueOnce({
        data: { number: 'D22222222' },
      });

      // Create purchase invoice
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 'pi-004' },
      });

      // Create line
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 'line-004' },
      });

      // Update SQL
      sqlService.runSql.mockResolvedValueOnce({});

      const result = await service.syncPurchaseInvoices(companyID, database, client_id, client_secret, tenant, entorno);

      expect(result).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/vendors'),
        expect.objectContaining({
          number: 'D22222222',
          displayName: 'Nuevo Proveedor',
        }),
        expect.any(Object),
      );
    });
  });

  describe('getPurchaseInvoiceByNumber', () => {
    it('should return invoice when found', async () => {
      const expectedInvoice = { id: 'pi-100', number: 'PI-100', vendorNumber: 'V001' };
      mockedAxios.get.mockResolvedValueOnce({
        data: { value: [expectedInvoice] },
      });

      const result = await service.getPurchaseInvoiceByNumber(companyID, client_id, client_secret, tenant, entorno, 'PI-100');

      expect(result).toEqual(expectedInvoice);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining("purchaseInvoices?$filter=number eq 'PI-100'"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );
    });

    it('should return null when invoice not found', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { value: [] },
      });

      const result = await service.getPurchaseInvoiceByNumber(companyID, client_id, client_secret, tenant, entorno, 'NONEXISTENT');

      expect(result).toBeNull();
    });

    it('should throw on API error', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('API Error'));

      await expect(
        service.getPurchaseInvoiceByNumber(companyID, client_id, client_secret, tenant, entorno, 'PI-ERR'),
      ).rejects.toThrow('API Error');
    });
  });
});
