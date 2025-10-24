import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';
import { response } from 'express';

//MQTT connect
const mqtt = require('mqtt');
const mqttOptions = {
  host: process.env.MQTT_HOST,
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASSWORD,
};

// Crear un cliente MQTT
const client = mqtt.connect(mqttOptions);

@Injectable()
export class traspasosService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  async syncSignings(companyNAME: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);

    let traspasos;
    try {
      traspasos = await this.sql.runSql(
        `SELECT * FROM [TRASPASO_ABAST_TMP] WHERE (StatusTraspasadoIME = 0 OR StatusTraspasadoIME = 2);`,
        database,
      );
    } catch (error) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('No existe la database');
      return false;
    }
    if (traspasos.recordset.length == 0) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('No hay registros');
      return false;
    }

    for (let i = 0; i < traspasos.recordset.length; i++) {
      let x = traspasos.recordset[i];

      let url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/ODataV4/Company('${companyNAME}')/traspaso?$filter=id eq '${x.Id}'`
      //console.log(url)
      let res = await axios
        .get(
          url,
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        )
        .catch((error) => {
          throw new Error('Failed to obtain access token');
        });

      if (!res.data) throw new Error('Failed to obtain access token');
      if (res.data.value.length === 0) {
        let newTraspaso;
        try {
          newTraspaso = await axios
            .post(
              `${process.env.baseURL}/v2.0/${tenant}/${entorno}/ODataV4/Company('${companyNAME}')/traspaso`,
              {
                id: x.Id,
                CodigoEmpresa: x.CodigoEmpresa,
                OrdenMovimientos: x.OrdenMovimientos,
                Asiento: x.Asiento,
                StatusTraspasadoIME: x.StatusTraspasadoIME,
                Ejercicio: x.Ejercicio,
                CargoAbono: x.CargoAbono,
                CodigoCuenta: x.CodigoCuenta,
                Contrapartida: x.Contrapartida,
                FechaAsiento: x.FechaAsiento,
                TipoDocumento: x.TipoDocumento,
                DocumentoConta: x.DocumentoConta,
                Comentario: x.Comentario,
                ImporteAsiento: x.ImporteAsiento,
                CodigoDiario: x.CodigoDiario,
                CodigoCanal: x.CodigoCanal,
                CodigoActividad: x.CodigoActividad,
                FechaVencimiento: x.FechaVencimiento,
                NumeroPeriodo: x.NumeroPeriodo,
                FechaGrabacion: x.FechaGrabacion,
                TipoEntrada: x.TipoEntrada,
                CodigoDepartamento: x.CodigoDepartamento,
                CodigoSeccion: x.CodigoSeccion,
                CodigoDivisa: x.CodigoDivisa,
                ImporteCambio: x.ImporteCambio,
                ImporteDivisa: x.ImporteDivisa,
                FactorCambio: x.FactorCambio,
                CodigoProyecto: x.CodigoProyecto,
                LibreN1: x.LibreN1,
                LibreN2: x.LibreN2,
                LibreA1: x.LibreA1,
                LibreA2: x.LibreA2,
                IdDelegacion: x.IdDelegacion,
                BaseIva1: x.BaseIva1,
                PorBaseCorrectora1: x.PorBaseCorrectora1,
                PorIva1: x.PorIva1,
                CuotaIva1: x.CuotaIva1,
                PorRecargoEquivalencia1: x.PorRecargoEquivalencia1,
                RecargoEquivalencia1: x.RecargoEquivalencia1,
                CodigoTransaccion1: x.CodigoTransaccion1,
                BaseIva2: x.BaseIva2,
                PorBaseCorrectora2: x.PorBaseCorrectora2,
                PorIva2: x.PorIva2,
                CuotaIva2: x.CuotaIva2,
                PorRecargoEquivalencia2: x.PorRecargoEquivalencia2,
                RecargoEquivalencia2: x.RecargoEquivalencia2,
                CodigoTransaccion2: x.CodigoTransaccion2,
                BaseIva3: x.BaseIva3,
                PorBaseCorrectora3: x.PorBaseCorrectora3,
                PorIva3: x.PorIva3,
                CuotaIva3: x.CuotaIva3,
                PorRecargoEquivalencia3: x.PorRecargoEquivalencia3,
                RecargoEquivalencia3: x.RecargoEquivalencia3,
                CodigoTransaccion3: x.CodigoTransaccion3,
                BaseIva4: x.BaseIva4,
                PorBaseCorrectora4: x.PorBaseCorrectora4,
                PorIva4: x.PorIva4,
                CuotaIva4: x.CuotaIva4,
                PorRecargoEquivalencia4: x.PorRecargoEquivalencia4,
                RecargoEquivalencia4: x.RecargoEquivalencia4,
                CodigoTransaccion4: x.CodigoTransaccion4,
                Año: x.Año,
                Serie: x.Serie,
                Factura: x.Factura,
                SuFacturaNo: x.SuFacturaNo,
                FechaFactura: x.FechaFactura,
                ImporteFactura: x.ImporteFactura,
                TipoFactura: x.TipoFactura,
                CodigoCuentaFactura: x.CodigoCuentaFactura,
                CifDni: x.CifDni,
                Nombre: x.Nombre,
                CodigoRetencion: x.CodigoRetencion,
                BaseRetencion: x.BaseRetencion,
                PorRetencion: x.PorRetencion,
                ImporteRetencion: x.ImporteRetencion,
                AbonoIva: x.AbonoIva,
                CodigoActividadF: x.CodigoActividadF,
                Intracomunitaria: x.Intracomunitaria,
                CodigoTerritorio: x.CodigoTerritorio,
                SiglaNacion: x.SiglaNacion,
                RetencionInformativa: x.RetencionInformativa,
                EjercicioFacturaOriginal: x.EjercicioFacturaOriginal,
                SerieFacturaOriginal: x.SerieFacturaOriginal,
                NumeroFacturaOriginal: x.NumeroFacturaOriginal,
                EjercicioFactura: x.EjercicioFactura,
                CobroPagoRetencion: x.CobroPagoRetencion,
                FechaOperacion: x.FechaOperacion,
                Exclusion347: x.Exclusion347,
                Previsiones: x.Previsiones,
                MantenerAsiento: x.MantenerAsiento,
                Metalico347: x.Metalico347,
                ClaveOperacionFactura_: x.ClaveOperacionFactura_,
                SerieAgrupacion_: x.SerieAgrupacion_,
                NumeroFacturaInicial_: x.NumeroFacturaInicial_,
                NumeroFacturaFinal_: x.NumeroFacturaFinal_,
                CodigoIva1: x.CodigoIva1,
                CodigoIva2: x.CodigoIva2,
                CodigoIva3: x.CodigoIva3,
                CodigoIva4: x.CodigoIva4,
                CriterioIva: x.CriterioIva,
                FechaMaxVencimiento: x.FechaMaxVencimiento,
                TipoCriterioCaja: x.TipoCriterioCaja,
                CodigoMedioCobro: x.CodigoMedioCobro,
                MedioCobro: x.MedioCobro,
                IvaDeducible1: x.IvaDeducible1,
                IvaDeducible2: x.IvaDeducible2,
                IvaDeducible3: x.IvaDeducible3,
                IvaDeducible4: x.IvaDeducible4,
                TipoRectificativa: x.TipoRectificativa,
                FechaFacturaOriginal: x.FechaFacturaOriginal,
                BaseImponibleOriginal: x.BaseImponibleOriginal,
                CuotaIvaOriginal: x.CuotaIvaOriginal,
                ClaseAbonoRectificativas: x.ClaseAbonoRectificativas,
                RecargoEquivalenciaOriginal: x.RecargoEquivalenciaOriginal,
                A_CTAASSIGNADA: x.A_CTAASSIGNADA,
                TEXTEERROR: x.TEXTEERROR,
                CifEuropeo: x.CifEuropeo,
                A_ASSENTAMENT: x.A_ASSENTAMENT
              },
              {
                headers: {
                  Authorization: 'Bearer ' + token,
                  'Content-Type': 'application/json',
                },
              },
            )
          await this.sql.runSql(
            `update [TRASPASO_ABAST_TMP] set StatusTraspasadoIME=1 where Id='${x.Id}'`,
            database,
          );
        } catch (error) {
          await this.sql.runSql(
            `update [TRASPASO_ABAST_TMP] set StatusTraspasadoIME=2 where Id='${x.Id}'`,
            database,
          );
          console.log(`Error: ${error}`)
        }
        if (!newTraspaso.data) return new Error('Failed to obtain access token');

        console.log(
          'Synchronizing signings... -> ' + i + '/' + traspasos.recordset.length,
          ' --- ',
          ((i / traspasos.recordset.length) * 100).toFixed(2) + '%',
          ' | Time left: ' + ((traspasos.recordset.length - i) * (0.5 / 60)).toFixed(2) +
          ' minutes',
        );
      } else {
        console.log(`Ya existe el traspaso con id: "${x.Id}"`)
        await this.sql.runSql(
          `update [TRASPASO_ABAST_TMP] set StatusTraspasadoIME=1 where Id='${x.Id}'`,
          database,
        );
      }
    }
    return true;
  }
}
