import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';

@Injectable()
export class vendorsSilemaService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  async getSaleFromAPI(companyID, docNumber, client_id: string, client_secret: string, tenant: string, entorno: string) {
    // Get the authentication token
    let token = await this.token.getToken();

    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=externalDocumentNumber eq '${docNumber}'`,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
      .catch((error) => {
        throw new Error('Failed to obtain ticket');
      });

    if (!res.data) throw new Error('Failed to obtain ticket');

    return res;
  }

  async syncVendorsSilema(companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/vendors?$filter=processHit eq true`;
    let res = await axios
      .get(
        url1,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
      .catch((error) => {
        console.log(`Url ERROR: ${url1}`)
        throw new Error('Failed to obtain vendors');
      });
    for (let i = 0; i < res.data.value.length; i++) {
      if (res.data.value[i].processHIT) {
        // console.log(`Proveedor a procesar: ${res.data.value[i].number}`)
        let id = res.data.value[i].id || '';
        let nombre = res.data.value[i].name || '';
        let nif = res.data.value[i].vatRegistrationNo || '';
        let direccion = res.data.value[i].address || '';
        let cp = res.data.value[i].postCode || '';
        let ciudad = res.data.value[i].city || '';
        let provincia = res.data.value[i].county || '';
        let pais = res.data.value[i].countryRegionCode || '';
        let tlf1 = res.data.value[i].phoneNo || '';
        let tlf2 = res.data.value[i].mobilePhoneNo || '';
        let alta = res.data.value[i].systemCreatedAt ? new Date(res.data.value[i].systemCreatedAt).toISOString().slice(0, 19).replace('T', ' ') : null;
        let activo = 1;
        let eMail = res.data.value[i].eMail || '';
        let codi = res.data.value[i].number || ''; // ???
        let FormaPago = res.data.value[i].paymentMethodCode || "";
        let FormaPagoValor = 0;

        //Comprovar que paymentMethodCode es 
        switch (FormaPago) {
          case 'RebutDomiciliat':
            FormaPagoValor = 1;
            break;
          case 'PROV_CHEQUE':
            FormaPagoValor = 2;
            break;
          case 'PROV_EFECTIVO':
            FormaPagoValor = 3;
            break;
          case 'PROV_TRANS':
            FormaPagoValor = 4;
            break;
        }
        let sqlSincroIds = `SELECT * FROM BC_SincroIds WHERE IdBc = '${res.data.value[i].number}'`;
        let querySincro = await this.sql.runSql(sqlSincroIds, database)
        if (cp.length <= 5) {
          if (querySincro.recordset.length == 0) {
            // Insert clients
            let sqlInsert = `INSERT INTO ccProveedores
          (id, nombre, nombreCorto, nif, direccion, cp, ciudad, provincia, pais, tlf1, tlf2, alta, activo, eMail, codi, tipoCobro) VALUES
          ('${id}', '${nombre}', '${nombre}', '${nif}', '${direccion}', '${cp}', '${ciudad}', '${provincia}', '${pais}', '${tlf1}', '${tlf2}', '${alta}', ${activo}, '${eMail}', '${codi}', '${FormaPagoValor}');`
            console.log(sqlInsert)

            let TipoDato = "proveedor"
            let IdBc = res.data.value[i].number || "";
            let IdHit = id;
            let IdEmpresaBc = companyID;
            let IdEmpresaHit = database;
            sqlSincroIds = `INSERT INTO BC_SincroIds 
        (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit) VALUES
        (GETDATE(), '${TipoDato}', '${IdBc}', '${IdHit}', '${IdEmpresaBc}', '${IdEmpresaHit}')`

            try {
              let queryInsert = await this.sql.runSql(sqlInsert, database)
              console.log('patata')
              let queryInsertSincro = await this.sql.runSql(sqlSincroIds, database)
              const data = {
                processedHIT: true
              };
              let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/vendors(${res.data.value[i].id})`
              const patchResponse = await axios.patch(url2, data, {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                  "If-Match": "*",
                },
              });
            } catch (error) {
              throw new Error('Failed to put vendor');
            }
            console.log("Vendor procesado")
          }
          else {
            let sqlUpdate = `UPDATE ccProveedores SET 
          nombre = '${nombre}',
          nombreCorto = '${nombre}',
          nif = '${nif}',
          direccion = '${direccion}',
          cp = '${cp}',
          ciudad = '${ciudad}',
          provincia = '${provincia}',
          pais = '${pais}',
          tlf1 = '${tlf1}',
          tlf2 = '${tlf2}',
          alta = '${alta}',
          activo = ${activo},
          eMail = '${eMail}',
          codi = '${codi}',
          tipoCobro = '${FormaPagoValor}'
          WHERE id = '${id}';`;
            try {
              let queryInsert = await this.sql.runSql(sqlUpdate, database)
              const data = {
                processedHIT: true
              };
              let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/vendors(${res.data.value[i].id})`
              const patchResponse = await axios.patch(url2, data, {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                  "If-Match": "*",
                },
              });
            } catch (error) {
              throw new Error('Failed to put vendor');
            }
            console.log("Vendor actualizado")
          }
        }
      }
      console.log(`Synchronizing vendors... -> ${i}/${res.data.value.length} --- ${((i / res.data.value.length) * 100).toFixed(2)}%`);
    }
    return true;
  }
}