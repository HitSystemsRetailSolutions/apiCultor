import { Module } from '@nestjs/common';
import { employeesController } from './employees/employees.controller';
import { employeesService } from './employees/employees.service';
import { getTokenService } from './conection/getToken.service';
import { ConfigModule } from '@nestjs/config';
import { runSqlService } from './conection/sqlConection.service';
import { signingsController } from './signings/signings.controller';
import { signingsService } from './signings/signings.service';
import { customersController } from './customers/customers.controller';
import { customersService } from './customers/customers.service';
import { itemsController } from './items/items.controller';
import { itemsService } from './items/items.service';
import { itemCategoriesController } from './itemCategories/itemCategories.controller';
import { itemCategoriesService } from './itemCategories/itemCategories.service';
import { salesTicketsController } from './sales/salesTickets.controller';
import { salesTicketsService } from './sales/salesTickets.service';
import { salesFacturasController } from './sales/salesFacturas.controller';
import { salesFacturasService } from './sales/salesFacturas.service';
import { companiesController } from './companies/companies.controller';
import { companiesService } from './companies/companies.service';
import { PdfController } from './pdf/pdf.controller';
import { PdfService } from './pdf/pdf.service';
import { IncidenciaController } from './incidencias/incidencia.controller';
import { IncidenciaService } from './incidencias/incidencia.service';
import { archivosController } from './archivos/archivos.controller';
import { archivosService } from './archivos/archivos.service';
import { empresasController } from './empresas/empresas.controller';
import { empresasService } from './empresas/empresas.service';



@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [
    employeesController, 
    signingsController, 
    customersController,
    itemsController,
    itemCategoriesController,
    salesTicketsController,
    salesFacturasController,
    companiesController,
    PdfController,
    IncidenciaController,
    archivosController,
    empresasController
  ],
  providers: [
    employeesService,
    getTokenService,
    runSqlService,
    signingsService,
    customersService,
    itemsService,
    itemCategoriesService,
    salesTicketsService,
    salesFacturasService,
    companiesService,
    PdfService,
    IncidenciaService,
    archivosService,
    empresasService
  ],
})
export class AppModule {}
