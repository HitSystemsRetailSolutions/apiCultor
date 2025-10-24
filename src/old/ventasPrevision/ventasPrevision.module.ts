import { Module } from '@nestjs/common';
import { ventasPrevisionController } from './ventasPrevision.controller';
import { ventasPrevisionService } from './ventasPrevision.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    controllers: [ventasPrevisionController],
    providers: [ventasPrevisionService],
})
export class VentasPrevisionModule { }