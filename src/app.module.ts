import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConnectionModule } from './connection/connection.module';
import { CompaniesModule } from './companies/companies.module';
import { InitConfigModule } from './configuracionInicial/initConfig.module';
import { EmployeesModule } from './employees/employees.module';
import { EmpresasModule } from './empresas/empresas.module';
import { HelpersModule } from './helpers/helpers.module';
import { MaestrosModule } from './maestros/maestros.module';
import { PdfModule } from './pdf/pdf.module';
import { InvoicesModule } from './sales/invoices/invoices.module';
import { TicketsModule } from './sales/tickets/tickets.module';
import { xmlModule } from './sales/xml/xml.module';
import { noSerieModule } from './sales/noSerie/noSerie.module';

@Module({
  imports: [ConfigModule.forRoot(),
    ConnectionModule,
    CompaniesModule,
    InitConfigModule,
    EmployeesModule,
    EmpresasModule,
    HelpersModule,
    MaestrosModule,
    PdfModule,
    InvoicesModule,
    TicketsModule,
    xmlModule,
    noSerieModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule { }
