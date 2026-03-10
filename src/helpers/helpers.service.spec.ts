import { helpersService } from './helpers.service';
import { writeFile, readFile, copyFile, access } from 'fs/promises';

jest.mock('fs/promises');

const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockCopyFile = copyFile as jest.MockedFunction<typeof copyFile>;
const mockAccess = access as jest.MockedFunction<typeof access>;

describe('helpersService', () => {
  let service: helpersService;

  beforeEach(() => {
    service = new helpersService();
    jest.clearAllMocks();
  });

  describe('parseEsTimestamp', () => {
    it('should parse a full Spanish timestamp (dd/mm/yyyy, hh:mm:ss)', () => {
      const result = service.parseEsTimestamp('15/03/2025, 14:30:45');
      expect(result).toBeInstanceOf(Date);
      expect(result.getDate()).toBe(15);
      expect(result.getMonth()).toBe(2); // March = 2
      expect(result.getFullYear()).toBe(2025);
      expect(result.getHours()).toBe(14);
      expect(result.getMinutes()).toBe(30);
      expect(result.getSeconds()).toBe(45);
    });

    it('should parse timestamp without seconds', () => {
      const result = service.parseEsTimestamp('1/1/2024, 9:05');
      expect(result).toBeInstanceOf(Date);
      expect(result.getDate()).toBe(1);
      expect(result.getMonth()).toBe(0);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getHours()).toBe(9);
      expect(result.getMinutes()).toBe(5);
      expect(result.getSeconds()).toBe(0);
    });

    it('should parse date-only timestamp', () => {
      const result = service.parseEsTimestamp('25/12/2023');
      expect(result).toBeInstanceOf(Date);
      expect(result.getDate()).toBe(25);
      expect(result.getMonth()).toBe(11);
      expect(result.getFullYear()).toBe(2023);
    });

    it('should return null for empty string', () => {
      expect(service.parseEsTimestamp('')).toBeNull();
    });

    it('should return null for null input', () => {
      expect(service.parseEsTimestamp(null)).toBeNull();
    });

    it('should return null for invalid format', () => {
      expect(service.parseEsTimestamp('2025-03-15')).toBeNull();
      expect(service.parseEsTimestamp('invalid')).toBeNull();
    });

    it('should handle whitespace', () => {
      const result = service.parseEsTimestamp('  15/03/2025, 14:30:45  ');
      expect(result).toBeInstanceOf(Date);
      expect(result.getDate()).toBe(15);
    });
  });

  describe('normalizeNIF', () => {
    it('should normalize a standard DNI (8 digits + letter)', () => {
      expect(service.normalizeNIF('12345678A')).toBe('12345678A');
    });

    it('should normalize a CIF (letter + 8 digits)', () => {
      expect(service.normalizeNIF('B12345678')).toBe('B12345678');
    });

    it('should normalize NIF with ES prefix', () => {
      expect(service.normalizeNIF('ES12345678A')).toBe('ES12345678A');
    });

    it('should normalize CIF with ES prefix', () => {
      expect(service.normalizeNIF('ESB12345678')).toBe('ESB12345678');
    });

    it('should handle NIF with letter + 7 digits + letter', () => {
      expect(service.normalizeNIF('A1234567B')).toBe('A1234567B');
    });

    it('should handle NIF with ES prefix + letter + 7 digits + letter', () => {
      expect(service.normalizeNIF('ESA1234567B')).toBe('ESA1234567B');
    });

    it('should convert to uppercase', () => {
      expect(service.normalizeNIF('b12345678')).toBe('B12345678');
    });

    it('should strip non-alphanumeric characters', () => {
      expect(service.normalizeNIF('12.345.678-A')).toBe('12345678A');
    });

    it('should trim whitespace', () => {
      expect(service.normalizeNIF('  12345678A  ')).toBe('12345678A');
    });

    it('should return empty string for empty input', () => {
      expect(service.normalizeNIF('')).toBe('');
    });

    it('should return empty string for null/undefined', () => {
      expect(service.normalizeNIF(null)).toBe('');
      expect(service.normalizeNIF(undefined)).toBe('');
    });

    it('should throw for invalid NIF format', () => {
      expect(() => service.normalizeNIF('INVALID')).toThrow('NIF inválido para BC');
    });

    it('should throw for too short NIF', () => {
      expect(() => service.normalizeNIF('123')).toThrow('NIF inválido para BC');
    });

    it('should handle 7 digit + letter format', () => {
      expect(service.normalizeNIF('1234567A')).toBe('1234567A');
    });

    it('should handle letter + 6 digits + letter format', () => {
      expect(service.normalizeNIF('A123456B')).toBe('A123456B');
    });
  });

  describe('addLog', () => {
    it('should create log file if it does not exist', async () => {
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
      mockWriteFile.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValueOnce('[]');
      mockCopyFile.mockResolvedValue(undefined);

      await service.addLog('tienda1', '2025-03-15', 'M', 'info', 'TEST', 'Test message', 'test');

      // Should have created the file
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('logs.json'),
        '[]',
        'utf8',
      );
    });

    it('should append log to existing logs', async () => {
      const existingLogs = [{ tipo: 'info', mensaje: 'old log' }];
      mockAccess.mockResolvedValueOnce(undefined);
      mockReadFile.mockResolvedValueOnce(JSON.stringify(existingLogs));
      mockCopyFile.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await service.addLog('tienda1', '2025-03-15', 'M', 'error', 'ERR01', 'Error message', 'invoices');

      const writeCall = mockWriteFile.mock.calls.find(
        (call) => typeof call[1] === 'string' && call[1] !== '[]',
      );
      expect(writeCall).toBeDefined();
      const writtenLogs = JSON.parse(writeCall[1] as string);
      expect(writtenLogs).toHaveLength(2);
      expect(writtenLogs[1].tipo).toBe('error');
      expect(writtenLogs[1].codigo).toBe('ERR01');
      expect(writtenLogs[1].mensaje).toBe('Error message');
      expect(writtenLogs[1].tienda).toBe('tienda1');
    });

    it('should restore from backup if main file is corrupt', async () => {
      const backupLogs = [{ tipo: 'info', mensaje: 'backup log' }];
      mockAccess.mockResolvedValueOnce(undefined);
      mockReadFile
        .mockRejectedValueOnce(new Error('corrupt')) // main file
        .mockResolvedValueOnce(JSON.stringify(backupLogs)); // backup
      mockCopyFile.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await service.addLog('tienda1', '2025-03-15', 'M', 'info', 'TEST', 'msg', 'test');

      const writeCall = mockWriteFile.mock.calls.find(
        (call) => typeof call[1] === 'string' && call[1] !== '[]',
      );
      const writtenLogs = JSON.parse(writeCall[1] as string);
      expect(writtenLogs).toHaveLength(2);
      expect(writtenLogs[0].mensaje).toBe('backup log');
    });

    it('should include all log fields', async () => {
      mockAccess.mockResolvedValueOnce(undefined);
      mockReadFile.mockResolvedValueOnce('[]');
      mockCopyFile.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await service.addLog('shop1', '2025-01-01', 'T', 'warning', 'W01', 'warn msg', 'pdf', 'company123', 'production');

      const writeCall = mockWriteFile.mock.calls.find(
        (call) => typeof call[1] === 'string' && call[1] !== '[]',
      );
      const writtenLogs = JSON.parse(writeCall[1] as string);
      const log = writtenLogs[0];
      expect(log.tienda).toBe('shop1');
      expect(log.fecha).toBe('2025-01-01');
      expect(log.turno).toBe('T');
      expect(log.tipo).toBe('warning');
      expect(log.codigo).toBe('W01');
      expect(log.mensaje).toBe('warn msg');
      expect(log.origen).toBe('pdf');
      expect(log.companyID).toBe('company123');
      expect(log.entorno).toBe('production');
      expect(log.timestamp).toBeDefined();
    });
  });

  describe('cleanOldLogs', () => {
    it('should remove logs older than 2 weeks', async () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000); // 20 days ago
      const recentDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day ago

      const formatEs = (d: Date) =>
        `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

      const logs = [
        { mensaje: 'old', timestamp: formatEs(oldDate) },
        { mensaje: 'recent', timestamp: formatEs(recentDate) },
      ];

      mockAccess.mockResolvedValueOnce(undefined);
      mockReadFile.mockResolvedValueOnce(JSON.stringify(logs));
      mockCopyFile.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await service.cleanOldLogs();

      const writeCall = mockWriteFile.mock.calls[0];
      const filteredLogs = JSON.parse(writeCall[1] as string);
      expect(filteredLogs).toHaveLength(1);
      expect(filteredLogs[0].mensaje).toBe('recent');
    });

    it('should do nothing if log file does not exist', async () => {
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

      await service.cleanOldLogs();

      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('should keep logs without timestamp', async () => {
      const logs = [
        { mensaje: 'no timestamp' },
        { mensaje: 'empty timestamp', timestamp: '' },
      ];

      mockAccess.mockResolvedValueOnce(undefined);
      mockReadFile.mockResolvedValueOnce(JSON.stringify(logs));
      mockCopyFile.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await service.cleanOldLogs();

      const writeCall = mockWriteFile.mock.calls[0];
      const filteredLogs = JSON.parse(writeCall[1] as string);
      expect(filteredLogs).toHaveLength(2);
    });
  });
});
