import { Module } from '@nestjs/common';
import { purchaseInvoicesController } from './purchaseInvoices.controller';
import { purchaseInvoicesService } from './purchaseInvoices.service';
import { ConnectionModule } from 'src/connection/connection.module';
import { HelpersModule } from 'src/helpers/helpers.module';

@Module({
  imports: [ConnectionModule, HelpersModule],
  controllers: [purchaseInvoicesController],
  providers: [purchaseInvoicesService],
  exports: [purchaseInvoicesService],
})
export class PurchaseInvoicesModule {}
