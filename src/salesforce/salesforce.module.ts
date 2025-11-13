import { Module } from '@nestjs/common';
import { SalesForceService } from './salesforce.service';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [HttpModule, ConfigModule],
  providers: [SalesForceService],
  exports: [SalesForceService],
})
export class SalesforceModule {}