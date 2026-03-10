import { writeFile, readFile, copyFile, access } from 'fs/promises';
import { join } from 'path';
import { Mutex } from 'async-mutex';
import { constants } from 'fs';

export class helpersService {
    private readonly logsPath = join(__dirname, '../../logs/logs.json');
    private static readonly logMutex = new Mutex();

    normalizeNIF(nif: string): string {
        if (!nif) return '';
        // Limpiar espacios y pasar a mayúsculas
        let normalized = nif.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

        // Transformamos los patrones usando letra = [A-Z] y número = \d
        const patterns = [
            /^ES\d{8}[A-Z]$/,   // ES########@
            /^\d{8}[A-Z]$/,     // ########@
            /^ES[A-Z]\d{8}$/,   // ES@########
            /^[A-Z]\d{8}$/,     // @########
            /^ES[A-Z]\d{7}[A-Z]$/, // ES@#######@
            /^[A-Z]\d{7}[A-Z]$/,   // @#######@
            /^[A-Z]\d{8}[A-Z]$/,   // @########@
            /^[A-Z]\d{6}[A-Z]$/,   // @######@
            /^[A-Z]\d{5}[A-Z]$/,   // @#####@
            /^\d{7}[A-Z]$/,     // #######@
            /^\d{6}[A-Z]$/,     // ######@
            /^\d{5}[A-Z]$/,     // #####@
            /^[A-Z]\d{7}$/,     // @#######
            /^[A-Z]\d{6}$/,     // @######
            /^[A-Z]\d{5}$/      // @#####
        ];

        for (const pattern of patterns) {
            if (pattern.test(normalized)) return normalized;
        }

        throw new Error(`NIF inválido para BC: ${nif}`);
    }
}