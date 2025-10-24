import { Module } from '@nestjs/common';
import { companiesController } from './companies.controller';
import { companiesService } from './companies.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    controllers: [companiesController],
    providers: [companiesService],
    exports: [companiesService],
})
export class CompaniesModule { }