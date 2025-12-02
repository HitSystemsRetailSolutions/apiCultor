import { Injectable } from '@nestjs/common';
import { runSqlService } from 'src/connection/sqlConnection.service';

@Injectable()
export class checksService {
    constructor(
        private sql: runSqlService,
    ) { }

    async validaCaja(botiga: string | number, year, month, day, horaInicio, horaFin, database, turno): Promise<boolean> {

        let iTargetaDATAFONO = 0;
        let iTargeta = 0;
        let importZ = 0;
        let importVenut = 0;

        // ===========================
        // SALTOS DE TICKET
        // ===========================
        const tickets = await this.sql.runSql(
            `SELECT MIN(num_tick) AS primerTick, MAX(num_tick) AS ultimTick
                FROM [v_venut_${year}-${month}]
                WHERE botiga = ${botiga} AND DAY(Data) = ${day}
                AND CONVERT(Time, Data) BETWEEN '${horaInicio}' AND '${horaFin}'`, database)

        const primerTick = tickets?.recordset[0]?.primerTick;
        const ultimTick = tickets?.recordset[0]?.ultimTick;

        if (primerTick && ultimTick) {
            const countRes = await this.sql.runSql(
                `SELECT COUNT(DISTINCT num_tick) AS nTicks
                    FROM (
                        SELECT * FROM [v_venut_${year}-${month}]
                        UNION ALL
                        SELECT * FROM [V_Anulats_${year}-${month}]
                    ) v
                    WHERE botiga = ${botiga} AND num_tick BETWEEN ${primerTick} AND ${ultimTick}`, database
            );

            const nTicks = countRes.recordset[0]?.nTicks ?? 0;
            const esperat = ultimTick - primerTick + 1;
            if (nTicks !== esperat) {
                await this.updateControlTableEntry(day, month, year, botiga, database, turno);
                return false;
            }
        }

        // ===========================
        // IMPORTE DATAFONO
        // ===========================
        const movDatafono = await this.sql.runSql(
            `SELECT ROUND(ABS(import), 2) AS import
                FROM [V_Moviments_${year}-${month}]
                WHERE botiga = ${botiga} AND DAY(Data) = ${day}
                AND CONVERT(Time, Data) BETWEEN '${horaInicio}' AND '${horaFin}' AND tipus_moviment = 'DATAFONO'`, database
        );
        if (movDatafono.recordset[0]) iTargetaDATAFONO = movDatafono.recordset[0].import;

        const movTargeta = await this.sql.runSql(
            `SELECT ISNULL(ROUND(ABS(SUM(import)), 2),0) AS import
                FROM [V_Moviments_${year}-${month}]
                WHERE DAY(Data) = ${day}
                AND CONVERT(Time, Data) BETWEEN '${horaInicio}' AND '${horaFin}'
                AND botiga = ${botiga}
                AND motiu LIKE 'Pagat Targeta:%'`, database
        );
        if (movTargeta.recordset[0]) iTargeta = movTargeta.recordset[0].import;

        if (Math.abs(iTargetaDATAFONO) !== Math.abs(iTargeta)) {
            console.log('Importes de datafono no coinciden', { iTargetaDATAFONO, iTargeta });
            // await this.updateControlTableEntry(day, month, year, botiga, database, turno);
            // return false;
        }

        // ===========================
        // VENTAS VS Z
        // ===========================
        const ventas = await this.sql.runSql(
            `SELECT ISNULL(ROUND(SUM(import), 2),0) AS import
                FROM [v_venut_${year}-${month}]
                WHERE botiga=${botiga} AND DAY(Data)=${day}
                AND CONVERT(Time, Data) BETWEEN '${horaInicio}' AND '${horaFin}'`, database
        );
        const zMovements = await this.sql.runSql(
            `SELECT ISNULL(ROUND(SUM(import), 2),0) AS import
                FROM [V_Moviments_${year}-${month}]
                WHERE botiga = ${botiga}
                AND Tipus_moviment = 'Z'
                AND DAY(Data) = ${day}
                AND CONVERT(Time, Data) BETWEEN '${horaInicio}' AND '${horaFin}'
                AND Import > 0`, database
        );
        if (ventas.recordset[0]) importVenut = ventas.recordset[0].import;

        if (zMovements.recordset[0]) importZ = zMovements.recordset[0].import;

        if (Math.abs(importZ - importVenut) > 0.01) {
            await this.updateControlTableEntry(day, month, year, botiga, database, turno);
            return false;
        }

        return true;
    }
    async updateControlTableEntry(day: string, month: string, year: string, botiga, database, turno?: number) {
        let sqlUpdate = `
        UPDATE RecordsBC SET EstatTraspas = 2
        WHERE day(TmStCaixa) = '${day}' AND month(TmStCaixa) = '${month}' AND year(TmStCaixa) = '${year}' AND Botiga = '${botiga}'`;
        if (turno !== undefined) {
            sqlUpdate += ` AND Torn = ${turno}`;
        }
        await this.sql.runSql(sqlUpdate, database);
    }
}
