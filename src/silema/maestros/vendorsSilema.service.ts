import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';

@Injectable()
export class vendorsSilemaService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  async syncVendorsSilema(companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/vendors?$filter=processHit eq true`;
    let res = await axios
      .get(url1, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      })
      .catch((error) => {
        console.log(`Url ERROR: ${url1}`);
        throw new Error('Failed to obtain vendors');
      });
    for (let i = 0; i < res.data.value.length; i++) {
      if (res.data.value[i].processHIT) {
        const proveedor = {
          id: res.data.value[i].id || '',
          nombre: res.data.value[i].name || '',
          nif: res.data.value[i].vatRegistrationNo || '',
          direccion: res.data.value[i].address || '',
          cp: res.data.value[i].postCode || '',
          ciudad: res.data.value[i].city || '',
          provincia: res.data.value[i].county || '',
          pais: res.data.value[i].countryRegionCode || '',
          tlf1: res.data.value[i].phoneNo || '',
          tlf2: res.data.value[i].mobilePhoneNo || '',
          alta: res.data.value[i].systemCreatedAt ? new Date(res.data.value[i].systemCreatedAt).toISOString().slice(0, 19).replace('T', ' ') : null,
          activo: 1,
          eMail: res.data.value[i].eMail || '',
          codi: res.data.value[i].number || '',
          FormaPago: res.data.value[i].paymentMethodCode || '',
          FormaPagoValor: 0,
          vencimiento: res.data.value[i].paymentTermsCode || '',
        };

        //1= Domiciliación, 2=Cheque, 3=Efectivo, 4=Transferencia, 5=Pago bloqueado, 6=Tarjeta

        const formaPagoMap = {
          PROV_CHEQU: 2,
          PROV_DOM: 1,
          PROV_REM_20: 1,
          PROV_TR_CON: 4,
          PROV_TRANS: 4,
        };
        proveedor.FormaPagoValor = formaPagoMap[proveedor.FormaPago] || 0;

        let sqlSincroIds = `SELECT * FROM BC_SincroIds WHERE IdBc = '${proveedor.codi}' AND IdEmpresaBc = '${companyID}' AND IdEmpresaHit = '${database}' AND TipoDato = 'proveedor'`;
        let querySincro = await this.sql.runSql(sqlSincroIds, database);
        if (proveedor.cp.length <= 5 && proveedor.nif) {
          if (querySincro.recordset.length == 0) {
            let sqlInserted = false;
            let checks = [`SELECT * FROM ccProveedores WHERE nif = '${proveedor.nif}'`];
            for (let sqlCheck of checks) {
              let queryCheck = await this.sql.runSql(sqlCheck, database);
              if (queryCheck.recordset.length == 0 && !sqlInserted) {
                await this.insertarProveedor(proveedor, token, database, companyID, tenant, entorno);
                sqlInserted = true;
              }
            }
            if (!sqlInserted) {
              console.log('El proveedor ya existe en la base de datos');

              let sqlGetCodi = `SELECT TOP 1 id FROM ccProveedores WHERE nif = '${proveedor.nif}'`;
              let result = await this.sql.runSql(sqlGetCodi, database);
              if (result.recordset.length > 0) {
                proveedor.id = result.recordset[0].id;
              } else {
                console.warn(`No se pudo encontrar el Codi del cliente para actualizar: ${proveedor.nif}`);
                continue;
              }
              await this.actualizarProveedor(2, proveedor, token, database, companyID, tenant, entorno);
            }
          } else {
            proveedor.id = querySincro.recordset[0].IdHit;
            await this.actualizarProveedor(1, proveedor, token, database, companyID, tenant, entorno);
          }
        }
      }
      console.log(`Synchronizing vendors... -> ${i}/${res.data.value.length} --- ${((i / res.data.value.length) * 100).toFixed(2)}%`);
    }
    return true;
  }

  async insertarProveedor(proveedor, token, database, companyID, tenant, entorno) {
    let sqlInsert = `INSERT INTO ccProveedores 
                      (id, nombre, nombreCorto, nif, direccion, cp, ciudad, provincia, pais, tlf1, tlf2, alta, activo, eMail, codi, tipoCobro) 
                      VALUES (
                        '${proveedor.id}', 
                        '${this.escapeSqlString(proveedor.nombre)}', 
                        '${this.escapeSqlString(proveedor.nombre)}', 
                        '${proveedor.nif}', 
                        '${this.escapeSqlString(proveedor.direccion)}', 
                        '${proveedor.cp}', 
                        '${this.escapeSqlString(proveedor.ciudad)}', 
                        '${this.escapeSqlString(proveedor.provincia)}', 
                        '${this.escapeSqlString(proveedor.pais)}', 
                        '${proveedor.tlf1}', 
                        '${proveedor.tlf2}', 
                        '${proveedor.alta}', 
                        ${proveedor.activo}, 
                        '${this.escapeSqlString(proveedor.eMail)}', 
                        '${proveedor.codi}', 
                        '${proveedor.FormaPagoValor}'
                      );`;

    let tipoDato = 'proveedor';

    let sqlSincroIds = `INSERT INTO BC_SincroIds (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit) 
      VALUES (GETDATE(), '${tipoDato}', '${proveedor.codi}', '${proveedor.id}', '${companyID}', '${database}')`;

    try {
      await this.sql.runSql(sqlInsert, database);
      await this.sql.runSql(sqlSincroIds, database);
      if (proveedor.vencimiento != '') await this.sqlProveedoresExtes(proveedor.id, 'VencimientoDias', proveedor.vencimiento, 2, database);
      await this.marcarProcesado(proveedor.id, token, companyID, tenant, entorno);
      console.log('Vendor procesado');
    } catch (error) {
      console.error(`Error al insertar el vendor: ID=${proveedor.id}, Nombre=${proveedor.nombre}, CompanyID=${companyID}`);
      console.error(error);
    }
  }

  async actualizarProveedor(accion, proveedor, token, database, companyID, tenant, entorno) {
    try {
      let sqlUpdate = `UPDATE ccProveedores SET 
                      nombre = '${this.escapeSqlString(proveedor.nombre)}',
                      nombreCorto = '${this.escapeSqlString(proveedor.nombre)}',
                      nif = '${proveedor.nif}',
                      direccion = '${this.escapeSqlString(proveedor.direccion)}',
                      cp = '${proveedor.cp}',
                      ciudad = '${this.escapeSqlString(proveedor.ciudad)}',
                      provincia = '${this.escapeSqlString(proveedor.provincia)}',
                      pais = '${this.escapeSqlString(proveedor.pais)}',
                      tlf1 = '${proveedor.tlf1}',
                      tlf2 = '${proveedor.tlf2}',
                      alta = '${proveedor.alta}',
                      activo = ${proveedor.activo},
                      eMail = '${this.escapeSqlString(proveedor.eMail)}',
                      codi = '${proveedor.codi}',
                      tipoCobro = '${proveedor.FormaPagoValor}'
                      WHERE id = '${proveedor.id}';`;
      if (accion == 1) {
        await this.sqlProveedoresExtes(proveedor.id, '', '', 5, database);
        await this.sql.runSql(sqlUpdate, database);
        if (proveedor.vencimiento != '') await this.sqlProveedoresExtes(proveedor.id, 'VencimientoDias', proveedor.vencimiento, 2, database);
        await this.marcarProcesado(proveedor.id, token, companyID, tenant, entorno);
        console.log('Vendor actualizado');
      } else if (accion == 2) {
        let tipoDato = 'proveedor';
        let sqlSincroIds = `INSERT INTO BC_SincroIds (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit) 
          VALUES (GETDATE(), '${tipoDato}', '${proveedor.codi}', '${proveedor.id}', '${companyID}', '${database}')`;
        await this.sqlProveedoresExtes(proveedor.id, '', '', 5, database);
        await this.sql.runSql(sqlUpdate, database);
        await this.sql.runSql(sqlSincroIds, database);
        if (proveedor.vencimiento != '') await this.sqlProveedoresExtes(proveedor.id, 'VencimientoDias', proveedor.vencimiento, 2, database);
        await this.marcarProcesado(proveedor.id, token, companyID, tenant, entorno);
        console.log('Vendor actualizado');
      }
    } catch (error) {
      console.error(`Error al actualizar el vendor: ID=${proveedor.id}, Nombre=${proveedor.nombre}, CompanyID=${companyID}`);
      console.error(error);
    }
  }
  async sqlProveedoresExtes(Codi, Variable, Valor, query, database) {
    /*
    query = 1 //SELECT
    query = 2 //INSERT
    query = 3 //UPDATE
    query = 4 //DELETE
    query = 5 //DELETE ALL from Codi
    */
    if (query == 1) {
      let sql = `SELECT * FROM ccProveedoresExtes WHERE id = ${Codi} and nom = ${Variable}`;
      let sqlQuery = await this.sql.runSql(sql, database);
      return sqlQuery.length;
    } else if (query == 2) {
      let sql = `INSERT INTO ccProveedoresExtes (id, nom, valor) VALUES ('${Codi}', '${Variable}', '${Valor}')`;
      let sqlQuery = await this.sql.runSql(sql, database);
    } else if (query == 3) {
      let sql = `UPDATE ccProveedoresExtes SET valor = '${Valor}' WHERE id = ${Codi} and nom = ${Variable}`;
      let sqlQuery = await this.sql.runSql(sql, database);
    } else if (query == 4) {
      let sql = `DELETE FROM ccProveedoresExtes WHERE id = ${Codi} and nom = ${Variable}`;
      let sqlQuery = await this.sql.runSql(sql, database);
    } else if (query == 5) {
      let sql = `DELETE FROM ccProveedoresExtes WHERE id = ${Codi}`;
      let sqlQuery = await this.sql.runSql(sql, database);
    }
  }

  async marcarProcesado(id, token, companyID, tenant, entorno) {
    try {
      const data = { processedHIT: true };
      let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/vendors(${id})`;
      await axios.patch(url2, data, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'If-Match': '*',
        },
      });
    } catch (error) {
      console.error(`Error al marcar el vendor como procesado: ID=${id}, CompanyID=${companyID}`);
      console.log(error.response.data);
    }
  }
  escapeSqlString(value) {
    if (value == null) return '';
    return String(value).replace(/'/g, '´');
  }
}
