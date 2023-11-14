import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import { response } from 'express';
@Injectable()
export class signingsService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  async syncsignings() {
    let token = await this.token.getToken();
    let signings = await this.sql.runSql(
      `select idr, tmst, accio, usuari, isnull(editor, '') editor, isnull(historial, '') historial, isnull(lloc, '') lloc, isnull(comentari, '') comentari, id from cdpDadesFichador where year(tmst)=2023 and month(tmst)=11 and day(tmst)=8 order by tmst`,
      'fac_tena',
    );
    for (let i = 0; i < signings.recordset.length; i++) {
      let x = signings.recordset[i];
      let res = await axios
        .get(
          `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/CdpDadesFichador?$filter=idr eq '${x.idr}'`,
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
        let newSignings = await axios
          .post(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/CdpDadesFichador`,
            {
              idr: x.idr,
              tmst: x.tmst,
              accio: x.accio,
              usuari: x.usuari,
              editor: x.editor,
              historial: x.historial,
              lloc: x.lloc,
              comentari: x.comentari,
              id: x.id,
            },
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

        if (!newSignings.data)
          return new Error('Failed to obtain access token');
        console.log(
          'Synchronizing signings... -> ' + i + '/' + signings.recordset.length,
          ' --- ',
          ((i / signings.recordset.length) * 100).toFixed(2) + '%',
          ' | Time left: ' +
            ((signings.recordset.length - i) * (0.5 / 60)).toFixed(2) +
            ' minutes',
        );
      } else {
        let z = res.data.value[0]['@odata.etag'];
        let newSignings = await axios
          .patch(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/cdpDadesFichador(${res.data.value[0].idr})`,
            {
              idr: x.idr,
              tmst: x.tmst,
              accio: x.accio,
              usuari: x.usuari,
              editor: x.editor,
              historial: x.historial,
              lloc: x.lloc,
              comentari: x.comentari,
              id: x.id,
            },
            {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
                'if-Match': z,
              },
            },
          )
          .catch((error) => {
            throw new Error('Failed to obtain access token');
          });
        if (!newSignings.data)
          return new Error('Failed to obtain access token');
        console.log(
          'Synchronizing signings... -> ' + i + '/' + signings.recordset.length,
          ' --- ',
          ((i / signings.recordset.length) * 100).toFixed(2) + '%',
          ' | Time left: ' +
            ((signings.recordset.length - i) * (0.5 / 60)).toFixed(2) +
            ' minutes',
        );
      }
    }
    return true;
  }
}
