import { Module } from '@nestjs/common';
import { verifactuService } from './verifactu.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule,],
    providers: [verifactuService],
    exports: [verifactuService],
})
export class verifactuModule { }
