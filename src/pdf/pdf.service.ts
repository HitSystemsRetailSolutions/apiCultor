import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';

@Injectable()
export class PdfService  {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  async obtenerFragmentosDeArchivo(nombreArchivo: string) {
    // Realiza una consulta SQL para recuperar los fragmentos asociados con el archivo
    const sql = `
      SELECT archivo FROM archivo WHERE nombre = '${nombreArchivo}' ORDER BY descripcion;
    `;
    let pdf;
    try{
      pdf =  await this.sql.runSql(
        sql,
        'Fac_Tena',
    );
    } catch{
        console.log("Error")
    }
    return pdf.recordset.map(row => Buffer.from(row.archivo, 'hex'));
  }

  async getPdf(pdfName: string) {
    try {
      // Obtén todos los fragmentos asociados con el archivo
      const fragmentos = await this.obtenerFragmentosDeArchivo(pdfName);

      // Verifica si el archivo existe
      if (!fragmentos || fragmentos.length === 0) {
        console.log("Archivo solicitado no existe")
        return { success: false, message: "El archivo solicitado no existe" };
      }

      // Concatena todos los fragmentos para reconstruir el archivo original
      const archivoCompleto = Buffer.concat(fragmentos);

      // No envíes la respuesta aquí, simplemente devuelve el archivo completo.
      return { success: true, pdfData: archivoCompleto };

    } catch (error) {
      console.error("Error al descargar el archivo:", error);
      return { success: false, message: "Error al descargar el archivo" };
    }
  }
}