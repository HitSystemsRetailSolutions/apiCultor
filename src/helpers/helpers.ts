import { writeFile, readFile, copyFile, access } from 'fs/promises';
import { join } from 'path';
import { Mutex } from 'async-mutex';
import { constants } from 'fs';

export class helpers {
    private readonly logsPath = join(__dirname, '../../logs/logs.json');
    private static readonly logMutex = new Mutex();

    async addLog(tienda, fecha: string, turno, tipo: 'info' | 'error' | 'warning' | 'debug', codigo: string, mensaje: string, origen: string = 'salesSilemaService', companyID?: string, entorno?: string) {
        const release = await helpers.logMutex.acquire();
        try {
            const timestamp = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
            const newLog = { tienda, fecha, turno, tipo, codigo, mensaje, origen, timestamp, companyID, entorno };

            try {
                await access(this.logsPath, constants.F_OK);
            } catch {
                await writeFile(this.logsPath, '[]', 'utf8');
            }

            // Leer logs actuales
            let logs: any[] = [];
            try {
                const data = await readFile(this.logsPath, 'utf8');
                logs = JSON.parse(data);
            } catch {
                // Restaurar desde backup si está corrupto
                try {
                    const backup = await readFile(this.logsPath + '.bak', 'utf8');
                    logs = JSON.parse(backup);
                } catch {
                    logs = [];
                }
            }

            logs.push(newLog);

            // Crear backup
            try {
                await copyFile(this.logsPath, this.logsPath + '.bak');
            } catch { }

            // Guardar archivo
            await writeFile(this.logsPath, JSON.stringify(logs, null, 2), 'utf8');
        } finally {
            release();
        }
    }
}