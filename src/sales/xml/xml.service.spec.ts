import { xmlService } from './xml.service';
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

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('xmlService', () => {
  let service: xmlService;
  let tokenService: jest.Mocked<getTokenService>;
  let sqlService: jest.Mocked<runSqlService>;

  beforeEach(() => {
    tokenService = {
      getToken2: jest.fn().mockResolvedValue('test-token'),
    } as any;

    sqlService = {
      runSql: jest.fn().mockResolvedValue({}),
    } as any;

    service = new xmlService(tokenService, sqlService);
    jest.clearAllMocks();

    process.env.baseURL = 'https://api.businesscentral.dynamics.com';

    tokenService.getToken2.mockResolvedValue('test-token');
    sqlService.runSql.mockResolvedValue({});
  });

  describe('getXML', () => {
    it('should fetch XML and upload to database', async () => {
      // GET document number
      mockedAxios.get
        .mockResolvedValueOnce({ data: { number: 'INV-001' } })
        // GET edocLog
        .mockResolvedValueOnce({ data: { value: [{ storageEntryNo: 42 }] } })
        // GET xml content
        .mockResolvedValueOnce({ data: '<xml>test</xml>' });

      // Mock subirXml (which calls getToken2 + axios.get + runSql)
      mockedAxios.get.mockResolvedValueOnce({
        data: { postingDate: '2025-03-15' },
      });

      const result = await service.getXML('comp1', 'testdb', 'cid', 'cs', 'tenant', 'prod', 'id-123', 'salesInvoices');

      expect(result).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('salesInvoices(id-123)'),
        expect.any(Object),
      );
    });

    it('should return false on error', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: { number: 'INV-001' } })
        .mockRejectedValueOnce(new Error('API Error'));

      const result = await service.getXML('comp1', 'testdb', 'cid', 'cs', 'tenant', 'prod', 'id-123', 'salesInvoices');

      expect(result).toBe(false);
    });
  });

  describe('subirXml', () => {
    it('should convert base64 to hex and save to database', async () => {
      const base64Content = Buffer.from('<xml>test</xml>').toString('base64');

      mockedAxios.get.mockResolvedValueOnce({
        data: { postingDate: '2025-03-15' },
      });

      await service.subirXml('fact-001', base64Content, 'testdb', 'cid', 'cs', 'tenant', 'prod', 'comp1', 'salesInvoices');

      expect(sqlService.runSql).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE BC_SyncSales_2025'),
        'testdb',
      );
      expect(sqlService.runSql).toHaveBeenCalledWith(
        expect.stringContaining("BC_IdSale='fact-001'"),
        'testdb',
      );
    });
  });
});
