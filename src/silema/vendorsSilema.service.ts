import { Injectable } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
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
          FormaPago: res.data.value[i].paymentMethodCode || "",
          FormaPagoValor: 0
        };

        const formaPagoMap = {
          'RebutDomiciliat': 1,
          'PROV_CHEQUE': 2,
          'PROV_EFECTIVO': 3,
          'PROV_TRANS': 4
        };
        proveedor.FormaPagoValor = formaPagoMap[proveedor.FormaPago] || 0;

        let sqlSincroIds = `SELECT * FROM BC_SincroIds WHERE IdBc = '${proveedor.codi}'`;
        let querySincro = await this.sql.runSql(sqlSincroIds, database);

        if (proveedor.cp.length <= 5) {
          if (querySincro.recordset.length == 0) {
            await this.insertarProveedor(proveedor, token, database, companyID, tenant, entorno);
          } else {
            await this.actualizarProveedor(proveedor, token, database, companyID, tenant, entorno);
          }
        }
      }
      console.log(`Synchronizing vendors... -> ${i}/${res.data.value.length} --- ${((i / res.data.value.length) * 100).toFixed(2)}%`);
    }
    return true;
  }

  async insertarProveedor(proveedor, token, database, companyID, tenant, entorno) {
    let sqlInsert = `INSERT INTO ccProveedores (id, nombre, nombreCorto, nif, direccion, cp, ciudad, provincia, pais, tlf1, tlf2, alta, activo, eMail, codi, tipoCobro) 
      VALUES ('${proveedor.id}', '${proveedor.nombre}', '${proveedor.nombre}', '${proveedor.nif}', '${proveedor.direccion}', '${proveedor.cp}', '${proveedor.ciudad}', '${proveedor.provincia}', '${proveedor.pais}', '${proveedor.tlf1}', '${proveedor.tlf2}', '${proveedor.alta}', ${proveedor.activo}, '${proveedor.eMail}', '${proveedor.codi}', '${proveedor.FormaPagoValor}');`;

    let tipoDato = "proveedor";

    let sqlSincroIds = `INSERT INTO BC_SincroIds (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit) 
      VALUES (GETDATE(), '${tipoDato}', '${proveedor.codi}', '${proveedor.id}', '${companyID}', '${database}')`;

    try {
      await this.sql.runSql(sqlInsert, database);
      await this.sql.runSql(sqlSincroIds, database);
      await this.marcarProcesado(proveedor.id, token, companyID, tenant, entorno);
      console.log("Vendor procesado");
    } catch (error) {
      console.error(`Error al insertar el vendor: ID=${proveedor.id}, Nombre=${proveedor.nombre}, CompanyID=${companyID}`);
      console.error(error);
    }
  }

  async actualizarProveedor(proveedor, token, database, companyID, tenant, entorno) {
    let sqlUpdate = `UPDATE ccProveedores SET 
      nombre = '${proveedor.nombre}',
      nombreCorto = '${proveedor.nombre}',
      nif = '${proveedor.nif}',
      direccion = '${proveedor.direccion}',
      cp = '${proveedor.cp}',
      ciudad = '${proveedor.ciudad}',
      provincia = '${proveedor.provincia}',
      pais = '${proveedor.pais}',
      tlf1 = '${proveedor.tlf1}',
      tlf2 = '${proveedor.tlf2}',
      alta = '${proveedor.alta}',
      activo = ${proveedor.activo},
      eMail = '${proveedor.eMail}',
      codi = '${proveedor.codi}',
      tipoCobro = '${proveedor.FormaPagoValor}'
      WHERE id = '${proveedor.id}';`;

    try {
      await this.sql.runSql(sqlUpdate, database);
      await this.marcarProcesado(proveedor.id, token, companyID, tenant, entorno);
      console.log("Vendor actualizado");
    } catch (error) {
      console.error(`Error al actualizar el vendor: ID=${proveedor.id}, Nombre=${proveedor.nombre}, CompanyID=${companyID}`);
      console.error(error);
    }
  }

  async marcarProcesado(id, token, companyID, tenant, entorno) {
    try {
      const data = { processedHIT: true };
      let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/vendors(${id})`;
      await axios.patch(url2, data, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "If-Match": "*",
        },
      });
    } catch (error) {
      console.error(`Error al marcar el vendor como procesado: ID=${id}, CompanyID=${companyID}`);
      console.error(error);
    }
  }
}