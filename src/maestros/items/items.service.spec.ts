import { itemsService } from './items.service';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';

jest.mock('axios');
jest.mock('mqtt', () => ({
  connect: jest.fn().mockReturnValue({
    publish: jest.fn(),
    on: jest.fn(),
    subscribe: jest.fn(),
  }),
}));
jest.mock('cli-progress', () => ({
  SingleBar: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    update: jest.fn(),
    stop: jest.fn(),
  })),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('itemsService', () => {
  let service: itemsService;
  let tokenService: jest.Mocked<getTokenService>;
  let sqlService: jest.Mocked<runSqlService>;

  beforeEach(() => {
    tokenService = {
      getToken: jest.fn().mockResolvedValue('test-token'),
      getToken2: jest.fn().mockResolvedValue('test-token'),
    } as any;

    sqlService = {
      runSql: jest.fn(),
      PoolCreation: jest.fn(),
    } as any;

    service = new itemsService(tokenService, sqlService);
    jest.clearAllMocks();

    process.env.baseURL = 'https://api.businesscentral.dynamics.com';
    process.env.tenaTenant = 'blocked-tenant';

    tokenService.getToken2.mockResolvedValue('test-token');
  });

  describe('getBaseUnitOfMeasure (private)', () => {
    it('should return KG when esSumable is 0', () => {
      const fn = (service as any).getBaseUnitOfMeasure.bind(service);
      expect(fn(0)).toBe('KG');
    });

    it('should return UDS when esSumable is 1', () => {
      const fn = (service as any).getBaseUnitOfMeasure.bind(service);
      expect(fn(1)).toBe('UDS');
    });

    it('should return KG when esSumable is false', () => {
      const fn = (service as any).getBaseUnitOfMeasure.bind(service);
      expect(fn(false)).toBe('KG');
    });

    it('should return UDS when esSumable is true', () => {
      const fn = (service as any).getBaseUnitOfMeasure.bind(service);
      expect(fn(true)).toBe('UDS');
    });
  });

  describe('syncItems', () => {
    it('should skip if tenant is blocked', async () => {
      const result = await service.syncItems('comp1', 'db', 'cid', 'cs', 'blocked-tenant', 'prod');

      expect(sqlService.runSql).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('should return false when no items found', async () => {
      sqlService.runSql.mockResolvedValueOnce({ recordset: [] });

      const result = await service.syncItems('comp1', 'db', 'cid', 'cs', 'tenant', 'prod');

      expect(result).toBe(false);
    });

    it('should return false on SQL error', async () => {
      sqlService.runSql.mockRejectedValueOnce(new Error('SQL error'));

      const result = await service.syncItems('comp1', 'db', 'cid', 'cs', 'tenant', 'prod');

      expect(result).toBe(false);
    });

    it('should create new item when not found in BC', async () => {
      const items = [{ Codi: '100', Nom: 'Test Item', Preu: 10.5, Familia: 'FAM1', EsSumable: 1, Iva: 21 }];
      sqlService.runSql.mockResolvedValueOnce({ recordset: items });

      // GET - item not found
      mockedAxios.get.mockResolvedValueOnce({ data: { value: [] } });
      // POST - create item
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 'item-001', '@odata.etag': 'etag1', VATProductPostingGroup: 'IVA21' },
      });
      // PATCH - update priceIncludesTax
      mockedAxios.patch.mockResolvedValueOnce({ data: {} });

      const result = await service.syncItems('comp1', 'db', 'cid', 'cs', 'tenant', 'prod');

      expect(result).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/items'),
        expect.objectContaining({
          number: '100',
          displayName: 'Test Item',
          VATProductPostingGroup: 'IVA21',
          baseUnitOfMeasureCode: 'UDS',
        }),
        expect.any(Object),
      );
    });

    it('should update existing item in BC', async () => {
      const items = [{ Codi: '100', Nom: 'Test Item', Preu: 10.5, Familia: 'FAM1', EsSumable: 0, Iva: 10 }];
      sqlService.runSql.mockResolvedValueOnce({ recordset: items });

      // GET - item found
      mockedAxios.get.mockResolvedValueOnce({
        data: { value: [{ id: 'item-existing', '@odata.etag': 'etag-old' }] },
      });
      // PATCH - update item
      mockedAxios.patch.mockResolvedValueOnce({
        data: { '@odata.etag': 'etag-new', VATProductPostingGroup: 'IVA10' },
      });
      // PATCH - update priceIncludesTax
      mockedAxios.patch.mockResolvedValueOnce({ data: {} });

      const result = await service.syncItems('comp1', 'db', 'cid', 'cs', 'tenant', 'prod');

      expect(result).toBe(true);
      expect(mockedAxios.patch).toHaveBeenCalledWith(
        expect.stringContaining('item-existing'),
        expect.objectContaining({
          number: '100',
          baseUnitOfMeasureCode: 'KG',
        }),
        expect.any(Object),
      );
    });

    it('should return itemId when codiHIT is provided', async () => {
      const items = [{ Codi: '200', Nom: 'Specific Item', Preu: 5.0, Familia: 'FAM2', EsSumable: 1, Iva: 4 }];
      sqlService.runSql.mockResolvedValueOnce({ recordset: items });

      mockedAxios.get.mockResolvedValueOnce({ data: { value: [] } });
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 'item-200', '@odata.etag': 'etag', VATProductPostingGroup: 'IVA4' },
      });
      mockedAxios.patch.mockResolvedValueOnce({ data: {} });

      const result = await service.syncItems('comp1', 'db', 'cid', 'cs', 'tenant', 'prod', '200');

      expect(result).toBe('item-200');
    });
  });
});
