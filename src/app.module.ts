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
import { InvoicesSilemaModule } from './silema/invoices/invoicesSilema.module';
import { MaestrosSilemaModule } from './silema/maestros/maestrosSilema.module';
import { CircuitoTiendasModule } from './silema/circuitoTiendas/circuitoTiendas.module';
import { PeticionesMqttModule } from './webPeticionesMqtt/peticionesMqtt.module';


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
    InvoicesSilemaModule,
    MaestrosSilemaModule,
    CircuitoTiendasModule,
    PeticionesMqttModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule { }
