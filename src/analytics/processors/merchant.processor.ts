import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger, Inject, NotFoundException } from '@nestjs/common';
import { ProcessorFactory } from '../../processors/processor.factory';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.provider';

interface MerchantJobData { merchantId: string; processorName: string; }



@Processor('merchant-analytics')
export class MerchantAnalyticsProcessor extends WorkerHost {
  private readonly logger = new Logger(MerchantAnalyticsProcessor.name);
  
 constructor(
    private readonly processorFactory: ProcessorFactory,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super();
  }

  async process(job: Job<MerchantJobData>): Promise<any> {
    const { merchantId, processorName } = job.data;
    
    if (!processorName || processorName === 'null') {
        this.logger.warn(`Skipping merchant ${merchantId}: Invalid processor name.`);
        return { status: 'skipped', netVolume: 0, transactionCount: 0 };
    }

    this.logger.log(`Processing merchant: ${merchantId} (${processorName})`);

    try {
      const processorService = this.processorFactory.getService(processorName);
      // const lastUpdatedKey = `merchant-volume-last-updated:${merchantId}`;
      const volumeKey = `merchant-volume:${merchantId}`;
      const countKey = `merchant-count:${merchantId}`;

      await this.redis.del(volumeKey, countKey);

      const now = new Date();
       const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      // Last day: 0th day of next month gives us the last day of current month
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const dateScope = { 
        from: firstDay.toISOString().split('T')[0], // "2025-11-01"
        to: lastDay.toISOString().split('T')[0]     // "2025-11-30"
      };
      
      this.logger.log(`Date Scope for ${merchantId}: ${dateScope.from} to ${dateScope.to}`);
      
      // const lastUpdated = await this.redis.get(lastUpdatedKey);
      
      
      const { netVolume, transactionCount } = await processorService.calculateVolumeAndCount(
        merchantId,
        processorName,
        dateScope,
      );

      // Set the final calculated values in Redis
      await this.redis.set(volumeKey, netVolume);
      await this.redis.set(countKey, transactionCount);
      
      this.logger.log(`Finished processing merchant ${merchantId}. Current Month Volume: ${netVolume}, Count: ${transactionCount}`);
      return { status: 'completed', netVolume, transactionCount };
    } catch (error) {
      const err = error as Error;
      
      if (err instanceof NotFoundException || (err.message && err.message.includes('not found'))) {
         this.logger.warn(`Skipping merchant ${job.data.merchantId}: Processor integration not supported. (${err.message})`);
         return { status: 'skipped', netVolume: 0, transactionCount: 0 };
      } else if (err.message && err.message.includes('Could not parse office code')) {
         this.logger.warn(`Skipping merchant ${job.data.merchantId}: Invalid Payroc format. (${err.message})`);
         return { status: 'skipped', netVolume: 0, transactionCount: 0 };
      }
      this.logger.error(`CRITICAL FAILURE for merchant ${job.data.merchantId}: ${err.message}`, err.stack);
      throw err;
    }

  }
}