import { runSqlService } from './sqlConnection.service';
import * as sql from 'mssql';

jest.mock('mssql');

describe('runSqlService', () => {
  let service: runSqlService;
  let mockQuery: jest.Mock;
  let mockRequest: jest.Mock;

  beforeEach(() => {
    service = new runSqlService();
    jest.clearAllMocks();

    mockQuery = jest.fn();
    mockRequest = jest.fn().mockReturnValue({ query: mockQuery });

    const mockPool = {
      request: mockRequest,
    };

    (sql.ConnectionPool as any) = jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(mockPool),
    }));

    process.env.user = 'testuser';
    process.env.password = 'testpass';
    process.env.server = 'testserver';
  });

  describe('runSql', () => {
    it('should execute SQL query with USE prefix', async () => {
      const expectedResult = { recordset: [{ id: 1, name: 'test' }] };
      mockQuery.mockResolvedValueOnce(expectedResult);

      // Force pool creation
      await service.PoolCreation();
      const result = await service.runSql('SELECT * FROM Users', 'testdb');

      expect(mockQuery).toHaveBeenCalledWith('use testdb; SELECT * FROM Users');
      expect(result).toEqual(expectedResult);
    });

    it('should prepend USE statement to queries', async () => {
      mockQuery.mockResolvedValueOnce({ recordset: [] });

      await service.PoolCreation();
      await service.runSql('SELECT 1', 'mydb');

      expect(mockQuery).toHaveBeenCalledWith('use mydb; SELECT 1');
    });

    it('should return query result', async () => {
      const records = [
        { codi: '001', nom: 'Article 1' },
        { codi: '002', nom: 'Article 2' },
      ];
      mockQuery.mockResolvedValueOnce({ recordset: records });

      await service.PoolCreation();
      const result = await service.runSql('SELECT * FROM Articles', 'hit');

      expect(result.recordset).toHaveLength(2);
      expect(result.recordset[0].codi).toBe('001');
    });
  });
});
