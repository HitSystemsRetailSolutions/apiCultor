import { Module } from '@nestjs/common';
import { empresasController } from './empresas.controller';
import { empresasService } from './empresas.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    controllers: [empresasController],
    providers: [empresasService],
    exports: [empresasService],
})
export class EmpresasModule { }
