import { Module } from '@nestjs/common';
import { salespersonService } from './salesperson.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    providers: [salespersonService],
    exports: [salespersonService],
})
export class SalespersonModule { }