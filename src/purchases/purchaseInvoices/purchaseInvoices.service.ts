import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import { helpersService } from 'src/helpers/helpers.service';
import axios from 'axios';
import * as mqtt from 'mqtt';
import { Mutex } from 'async-mutex';

@Injectable()
export class purchaseInvoicesService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });
  private locks = new Map<string, Mutex>();

  constructor(
    private tokenService: getTokenService,
    private sql: runSqlService,
    private helpers: helpersService,
  ) { }

  private getLock(key: string): Mutex {
    if (!this.locks.has(key)) {
      this.locks.set(key, new Mutex());
    }
    return this.locks.get(key);
  }

  async syncPurchaseInvoices(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    if (tenant === process.env.tenaTenant) {
      return true;
    }

    let facturas;
    try {
      const sqlQuery = `
        SELECT f.NumFactura, f.DataFactura, f.NifProveidor, f.NomProveidor,
               f.BaseImposable, f.Iva AS TipoIva, f.ImportIva, f.Total,
               f.SerieFactura, f.DataRegistre
        FROM FacturesRebudes f
        WHERE f.BC_Sync IS NULL OR f.BC_Sync = 0
        ORDER BY f.DataFactura
      `;
      facturas = await this.sql.runSql(sqlQuery, database);
    } catch (error) {
      this.logError(`Error al ejecutar la consulta SQL de facturas rebudes en la base de datos '${database}'`, error);
      throw error;
    }

    if (facturas.recordset.length === 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay facturas rebudes pendientes de sincronizar');
      console.log('No se encontraron facturas rebudes pendientes de sincronizar');
      return false;
    }

    let i = 1;
    for (const factura of facturas.recordset) {
      try {
        if (this.getLock(factura.NumFactura).isLocked()) {
          console.log(`Esperando liberacion del bloqueo para la factura rebuda ${factura.NumFactura}...`);
        }
        await this.getLock(factura.NumFactura).runExclusive(async () => {
          const token = await this.tokenService.getToken2(client_id, client_secret, tenant);

          // Get or create vendor by NIF
          const vendorNumber = await this.getOrCreateVendor(
            companyID, client_id, client_secret, tenant, entorno, token,
            factura.NifProveidor, factura.NomProveidor,
          );

          if (!vendorNumber) {
            this.logError(`No se pudo obtener o crear el proveedor con NIF ${factura.NifProveidor}`, { message: 'Vendor not found or created' });
            return;
          }

          const invoiceDate = factura.DataFactura instanceof Date
            ? factura.DataFactura.toISOString().split('T')[0]
            : String(factura.DataFactura).split('T')[0];

          const postingDate = factura.DataRegistre instanceof Date
            ? factura.DataRegistre.toISOString().split('T')[0]
            : invoiceDate;

          const vendorInvoiceNumber = factura.SerieFactura
            ? factura.SerieFactura + factura.NumFactura
            : String(factura.NumFactura);

          // Create purchase invoice in BC
          const purchaseInvoiceData = {
            vendorNumber: vendorNumber,
            invoiceDate: invoiceDate,
            postingDate: postingDate,
            vendorInvoiceNumber: vendorInvoiceNumber,
          };

          let createdInvoice;
          try {
            createdInvoice = await axios.post(
              `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/purchaseInvoices`,
              purchaseInvoiceData,
              {
                headers: {
                  Authorization: 'Bearer ' + token,
                  'Content-Type': 'application/json',
                },
              },
            );
          } catch (error) {
            this.logError(`Error al crear la factura rebuda ${factura.NumFactura} en BC`, error);
            return;
          }

          const purchaseInvoiceId = createdInvoice.data.id;

          // Add invoice line
          try {
            const lineData = {
              lineType: 'Account',
              description: `Factura ${vendorInvoiceNumber} - ${factura.NomProveidor}`,
              unitPrice: factura.BaseImposable,
              quantity: 1,
            };

            await axios.post(
              `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/purchaseInvoices(${purchaseInvoiceId})/purchaseInvoiceLines`,
              lineData,
              {
                headers: {
                  Authorization: 'Bearer ' + token,
                  'Content-Type': 'application/json',
                },
              },
            );
          } catch (error) {
            this.logError(`Error al crear linea de factura rebuda ${factura.NumFactura} en BC`, error);
          }

          // Mark as synced in SQL
          try {
            const updateQuery = `UPDATE FacturesRebudes SET BC_Sync=1, BC_IdPurchase='${purchaseInvoiceId}' WHERE NumFactura='${factura.NumFactura}'`;
            await this.sql.runSql(updateQuery, database);
          } catch (error) {
            this.logError(`Error al actualizar BC_Sync para la factura rebuda ${factura.NumFactura}`, error);
          }

          console.log(`Sincronizada factura rebuda ${factura.NumFactura} ... -> ${i}/${facturas.recordset.length} --- ${((i / facturas.recordset.length) * 100).toFixed(2)}%`);
        });
      } catch (error) {
        this.logError(`Error al procesar la factura rebuda ${factura.NumFactura}`, error);
        continue;
      }
      i++;
    }

    return true;
  }

  async getPurchaseInvoiceByNumber(companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string, invoiceNumber: string) {
    try {
      const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
      const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/purchaseInvoices?$filter=number eq '${invoiceNumber}'`;
      const res = await axios.get(url, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });

      if (res.data.value.length === 0) {
        return null;
      }

      return res.data.value[0];
    } catch (error) {
      this.logError(`Error al obtener la factura rebuda con numero ${invoiceNumber}`, error);
      throw error;
    }
  }

  private async getOrCreateVendor(
    companyID: string, client_id: string, client_secret: string,
    tenant: string, entorno: string, token: string,
    nif: string, name: string,
  ): Promise<string | null> {
    try {
      const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/vendors?$filter=number eq '${nif}'`;
      const res = await axios.get(url, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });

      if (res.data.value.length > 0) {
        return res.data.value[0].number;
      }

      // Create vendor
      const vendorData = {
        number: nif,
        displayName: name,
      };

      const created = await axios.post(
        `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/vendors`,
        vendorData,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      );

      return created.data.number;
    } catch (error) {
      this.logError(`Error al obtener o crear el proveedor con NIF ${nif}`, error);
      return null;
    }
  }

  private logError(message: string, error: any) {
    const errorDetail = error?.response?.data || error?.message || 'Error desconocido';
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: errorDetail }));
    console.error(message, errorDetail);
  }
}
