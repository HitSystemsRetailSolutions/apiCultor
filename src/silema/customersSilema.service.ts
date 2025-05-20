import { Injectable } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
import axios from 'axios';
import { query } from 'express';

@Injectable()
export class customersSilemaService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  // Hay que sincronizar primero los clientes finales (contacts) antes que los clientes (customers)
  async syncCustomersSilema(companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/customers?$filter=processHit eq true`;
    let res = await axios
      .get(url1, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      })
      .catch((error) => {
        console.log(`Url ERROR: ${url1}`);
        throw new Error('Failed to obtain customers');
      });
    for (let i = 0; i < res.data.value.length; i++) {
      if (res.data.value[i].processHIT) {
        let sqlCodi = `SELECT MAX(t1.Codi + 1) AS codigo_disponible FROM clients t1 LEFT JOIN clients t2 ON t1.Codi + 1 = t2.Codi WHERE t2.Codi IS NULL;`;
        let queryCodi = await this.sql.runSql(sqlCodi, database);

        // console.log(`Cliente a procesar: ${res.data.value[i].number}`)
        const customer = {
          Codi: queryCodi.recordset[0].codigo_disponible || 0, // Número convertido a entero o 0 si es inválido
          Nom: res.data.value[i].name || '', // Nombre o cadena vacía
          Nif: res.data.value[i].vatRegistrationNo || '', // CIF/NIF o cadena vacía
          Adresa: res.data.value[i].address || '', // Dirección o cadena vacía
          Ciutat: res.data.value[i].city || '', // Ciudad o cadena vacía
          Cp: res.data.value[i].postCode || 0, // Código postal como entero o 0
          NomLlarg: res.data.value[i].name || '', // Nombre largo concatenado
          eMail: res.data.value[i].eMail || '',
          phone: res.data.value[i].phoneNo || '',
          FormaPago: res.data.value[i].paymentMethodCode || '',
          FormaPagoValor: 0,
          primaryContactNo: res.data.value[i].primaryContactNo || '',
          IdHitCFINAL: '',
          pagaEnTienda: res.data.value[i].payInStore || true,
          IdBc: res.data.value[i].id || '',
          numberBC: res.data.value[i].number || '',
        };
        
        //Comprobar que paymentMethodCode es
        switch (customer.FormaPago) {
          case 'RebutDomiciliat':
            customer.FormaPagoValor = 1;
            break;
          case 'Cheque':
            customer.FormaPagoValor = 2;
            break;
          case 'CLI_EFECTIVO':
            customer.FormaPagoValor = 3;
            break;
          case 'CLI_TRANSF':
            customer.FormaPagoValor = 4;
            break;
        }
        if (customer.primaryContactNo != '') {
          let sqlCFINAL = `SELECT * FROM BC_SincroIds WHERE IdBc = '${customer.primaryContactNo}' AND IdEmpresaBc = '${companyID}' AND IdEmpresaHit = '${database}' AND TipoDato = 'contacto'`;
          // console.log(sqlCFINAL);
          let queryCFINAL = await this.sql.runSql(sqlCFINAL, database);
          if (queryCFINAL.recordset.length > 0 && queryCFINAL.recordset[0].IdHit != null) customer.IdHitCFINAL = queryCFINAL.recordset[0].IdHit;
          else console.log(`El "clientFinal" con IdBc *${customer.primaryContactNo}* no existe en la base de datos o no tiene un IdHit`);
        }
        let sqlSincroIds = `SELECT * FROM BC_SincroIds WHERE IdBc = '${customer.IdBc}' AND IdEmpresaBc = '${companyID}' AND IdEmpresaHit = '${database}' AND TipoDato = 'customer'`;
        let querySincro = await this.sql.runSql(sqlSincroIds, database);
        try {
          if (querySincro.recordset.length == 0) {
            let sqlInserted = false;
            let checks = [`SELECT * FROM clients WHERE Nif = '${customer.Nif}'`];
            for (let check of checks) {
              let queryCheck = await this.sql.runSql(check, database);
              if (queryCheck.recordset.length == 0 && !sqlInserted) {
                await this.insertarCustomer(customer, token, database, companyID, tenant, entorno);
                sqlInserted = true;
              }
            }
            if (!sqlInserted) {
              console.log(`Customer con NIF *${customer.Nif}* ya existe en la base de datos`);
              let sqlGetCodi = `SELECT TOP 1 Codi FROM clients WHERE Nif = '${customer.Nif}'`;
              let result = await this.sql.runSql(sqlGetCodi, database);
              if (result.recordset.length > 0) {
                customer.Codi = result.recordset[0].Codi;
              } else {
                console.log(`No se encontró el cliente con NIF ${customer.Nif}`);
                continue;
              }
              await this.actualizarCustomer(2, customer, token, database, companyID, tenant, entorno);
            }
          } else {
            customer.Codi = querySincro.recordset[0].IdHit;
            await this.actualizarCustomer(1, customer, token, database, companyID, tenant, entorno);
          }
        } catch (error) {
          console.log('Error al insertar el cliente:', error);
          continue;
        }
      }
      console.log(`Synchronizing customers... -> ${i}/${res.data.value.length} --- ${((i / res.data.value.length) * 100).toFixed(2)}%`);
    }

    return true;
  }

  async insertarCustomer(customer, token, database, companyID, tenant, entorno) {
    let sqlInsert = `INSERT INTO clients 
              (Codi, Nom, Nif, Adresa, Ciutat, Cp, [Nom Llarg]) VALUES
              (${customer.Codi}, 
              '${this.escapeSqlString(customer.Nom)}', 
              '${customer.Nif}', 
              '${this.escapeSqlString(customer.Adresa)}', 
              '${this.escapeSqlString(customer.Ciutat)}', 
              '${customer.Cp}', 
              '${this.escapeSqlString(customer.NomLlarg)}')`;
    let TipoDato = 'customer';

    let sqlSincroIds = `INSERT INTO BC_SincroIds 
            (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit) VALUES
            (GETDATE(), '${TipoDato}', '${customer.numberBC}', '${customer.Codi}', '${companyID}', '${database}')`;
    try {
      await this.sql.runSql(sqlInsert, database);
      await this.sql.runSql(sqlSincroIds, database);
      if (customer.eMail != '') await this.sqlConstantClient(customer.Codi, 'eMail', customer.eMail, 2, database);
      if (customer.phone != '') await this.sqlConstantClient(customer.Codi, 'Tel', customer.phone, 2, database);
      if (customer.FormaPagoValor) await this.sqlConstantClient(customer.Codi, 'FormaPagoLlista', customer.FormaPagoValor, 2, database);
      if (!customer.pagaEnTienda) await this.sqlConstantClient(customer.Codi, 'NoPagaEnTienda', 'NoPagaEnTienda', 2, database);
      if (customer.IdHitCFINAL != '') await this.sqlConstantClient(customer.Codi, 'CFINAL', customer.IdHitCFINAL, 2, database);
      this.marcaProcesado(customer.IdBc, token, companyID, tenant, entorno);
    } catch (error) {
      console.log('Error al insertar el cliente:', error);
    }
  }
  async actualizarCustomer(accion, customer, token, database, companyID, tenant, entorno) {
    try {
      let sqlUpdate = `UPDATE clients SET 
            Nom = '${this.escapeSqlString(customer.Nom)}',
            Nif = '${customer.Nif}',
            Adresa = '${this.escapeSqlString(customer.Adresa)}',
            Ciutat = '${this.escapeSqlString(customer.Ciutat)}',
            Cp = '${customer.Cp}',
            [Nom Llarg] = '${this.escapeSqlString(customer.NomLlarg)}'
            WHERE Codi = ${customer.Codi};`;

      if (accion == 1) {
        await this.sqlConstantClient(customer.Codi, '', '', 5, database);
        await this.sql.runSql(sqlUpdate, database);
        if (customer.eMail != '') await this.sqlConstantClient(customer.Codi, 'eMail', customer.eMail, 2, database);
        if (customer.phone != '') await this.sqlConstantClient(customer.Codi, 'Tel', customer.phone, 2, database);
        if (customer.FormaPagoValor) await this.sqlConstantClient(customer.Codi, 'FormaPagoLlista', customer.FormaPagoValor, 2, database);
        if (!customer.pagaEnTienda) await this.sqlConstantClient(customer.Codi, 'NoPagaEnTienda', 'NoPagaEnTienda', 2, database);
        if (customer.IdHitCFINAL != '') await this.sqlConstantClient(customer.Codi, 'CFINAL', customer.IdHitCFINAL, 2, database);
        this.marcaProcesado(customer.IdBc, token, companyID, tenant, entorno);
        console.log('Customer actualizado');
      } else if (accion == 2) {
        let TipoDato = 'customer';

        let sqlSincroIds = `INSERT INTO BC_SincroIds 
            (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit) VALUES
            (GETDATE(), '${TipoDato}', '${customer.numberBC}', '${customer.Codi}', '${companyID}', '${database}')`;
        await this.sqlConstantClient(customer.Codi, '', '', 5, database);
        await this.sql.runSql(sqlSincroIds, database);
        await this.sql.runSql(sqlUpdate, database);
        if (customer.eMail != '') await this.sqlConstantClient(customer.Codi, 'eMail', customer.eMail, 2, database);
        if (customer.phone != '') await this.sqlConstantClient(customer.Codi, 'Tel', customer.phone, 2, database);
        if (customer.FormaPagoValor) await this.sqlConstantClient(customer.Codi, 'FormaPagoLlista', customer.FormaPagoValor, 2, database);
        if (!customer.pagaEnTienda) await this.sqlConstantClient(customer.Codi, 'NoPagaEnTienda', 'NoPagaEnTienda', 2, database);
        if (customer.IdHitCFINAL != '') await this.sqlConstantClient(customer.Codi, 'CFINAL', customer.IdHitCFINAL, 2, database);
        this.marcaProcesado(customer.IdBc, token, companyID, tenant, entorno);
        console.log('Customer actualizado');
      }
    } catch (error) {
      console.error('Error al actualizar el cliente:', error);
    }
  }
  async sqlConstantClient(Codi, Variable, Valor, query, database) {
    /*
    query = 1 //SELECT
    query = 2 //INSERT
    query = 3 //UPDATE
    query = 4 //DELETE
    query = 5 //DELETE ALL from Codi
    */
    if (query == 1) {
      let sql = `SELECT * FROM constantClient WHERE Codi = ${Codi} and Variable = ${Variable}`;
      let sqlQuery = await this.sql.runSql(sql, database);
      return sqlQuery.length;
    } else if (query == 2) {
      let sql = `INSERT INTO constantsclient (Codi, Variable, Valor) VALUES ('${Codi}', '${Variable}', '${Valor}')`;
      let sqlQuery = await this.sql.runSql(sql, database);
    } else if (query == 3) {
      let sql = `UPDATE constantsclient SET Valor = '${Valor}' WHERE Codi = ${Codi} and Variable = ${Variable}`;
      let sqlQuery = await this.sql.runSql(sql, database);
    } else if (query == 4) {
      let sql = `DELETE FROM constantsclient WHERE Codi = ${Codi} and Variable = ${Variable}`;
      let sqlQuery = await this.sql.runSql(sql, database);
    } else if (query == 5) {
      let sql = `DELETE FROM constantsclient WHERE Codi = ${Codi}`;
      let sqlQuery = await this.sql.runSql(sql, database);
    }
  }

  async marcaProcesado(id, token, companyID, tenant, entorno) {
    try {
      const data = { processedHIT: true };
      let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/customers(${id})`;
      await axios.patch(url2, data, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'If-Match': '*',
        },
      });
    } catch (error) {
      throw new Error('Failed to put customer');
    }
  }
  escapeSqlString(value) {
    if (value == null) return '';
    return String(value).replace(/'/g, '´');
  }
}
