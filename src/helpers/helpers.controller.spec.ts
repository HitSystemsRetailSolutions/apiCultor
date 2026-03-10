import { HelpersController } from './helpers.controller';
import { readFileSync } from 'fs';

jest.mock('fs', () => ({
  readFileSync: jest.fn(),
}));

const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

describe('HelpersController', () => {
  let controller: HelpersController;

  beforeEach(() => {
    controller = new HelpersController();
    jest.clearAllMocks();
  });

  describe('getLogs', () => {
    it('should return parsed logs', () => {
      const logs = [
        { tipo: 'info', mensaje: 'test log 1' },
        { tipo: 'error', mensaje: 'test log 2' },
      ];
      mockReadFileSync.mockReturnValueOnce(JSON.stringify(logs));

      const result = controller.getLogs();

      expect(result).toEqual(logs);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when log file is empty array', () => {
      mockReadFileSync.mockReturnValueOnce('[]');

      const result = controller.getLogs();

      expect(result).toEqual([]);
    });

    it('should throw on invalid JSON', () => {
      mockReadFileSync.mockReturnValueOnce('invalid json');

      expect(() => controller.getLogs()).toThrow();
    });
  });
});
