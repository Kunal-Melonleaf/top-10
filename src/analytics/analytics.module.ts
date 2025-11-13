import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { SalesforceModule } from '../salesforce/salesforce.module';
import { ProcessorModule } from '../processors/processors.module';
import { AnalyticsCronService } from './analytics.cron.service';
import { AnalyticsController } from './analytics.controller';
import { UserAnalyticsProcessor } from './processors/user.processor';
import { MerchantAnalyticsProcessor } from './processors/merchant.processor';
import { FinalizationProcessor } from './processors/finalization.processor';

@Module({
  imports: [
    ScheduleModule.forRoot(),
   BullModule.registerQueue(
      { 
        name: 'user-analytics',
        defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 10000 } }
      },
      { 
        name: 'merchant-analytics',
        defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 30000 } }
      },
      { 
        name: 'finalization',
        defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 5000 } }
      },
    ),
    SalesforceModule,
    ProcessorModule,
  ],
  providers: [
    AnalyticsCronService,
    UserAnalyticsProcessor,
    MerchantAnalyticsProcessor,
    FinalizationProcessor,
  ],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}