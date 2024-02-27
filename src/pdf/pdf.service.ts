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

  async subirPdf(nombre: string, archivoBase64: string) {
    // Convierte el Base64 a Buffer
    const bufferArchivo = Buffer.from(archivoBase64, 'base64');

    // Divide el Buffer en fragmentos más pequeños (por ejemplo, de 1 KB)
    const chunks = [];
    const chunkSize = bufferArchivo.length; // Tamaño de cada fragmento en bytes
    for (let i = 0; i < bufferArchivo.length; i += chunkSize) {
      const chunk = bufferArchivo.slice(i, i + chunkSize);
      chunks.push(chunk.toString('hex'));
    }

    try {
      // Inserta los fragmentos en filas separadas
      for (let i = 0; i < chunks.length; i++) {
        const descripcion = `part ${i}`;
        const sql = `
          INSERT INTO archivo (id, nombre, extension, descripcion, archivo)
          VALUES (newid(), '${nombre}', 'PDF', '${descripcion}', 0x${chunks[i]})
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
      }

      return { msg: "Se ha insertado correctamente" };
    } catch (error) {
      console.error('Error al insertar el PDF en la base de datos:', error);
      throw error;
    }
  }
}