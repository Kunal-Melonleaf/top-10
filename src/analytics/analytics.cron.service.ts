import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { SalesForceService, SalesforceUser, Top10UpdatePayload  } from '../salesforce/salesforce.service';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.provider';

@Injectable()
export class AnalyticsCronService {
  private readonly logger = new Logger(AnalyticsCronService.name);
  private isSalesforceUpdateRunning = false;

  constructor(
    @InjectQueue('user-analytics') private readonly userAnalyticsQueue: Queue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly salesforceService: SalesForceService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleDailyAnalyticsCron() {
    this.logger.log('Starting daily top merchants analytics job...');
    try {
      const users: SalesforceUser[] = await this.salesforceService.getAllUsers();
      this.logger.log(`Found ${users.length} active users to process.`);
      
      for (const user of users) {
        const lockAcquired = await this.redis.set(`analytics-status:${user.Id}`, 'queued', 'EX', 12 * 3600, 'NX');
        if (lockAcquired) {
            await this.userAnalyticsQueue.add('process-user', { userId: user.Id, portalId: user.PortalId__c });
        } else {
            this.logger.warn(`Skipping user ${user.Id} in cron; job already exists or is running.`);
        }
      }
      this.logger.log('All user analytics jobs have been queued.');
    } catch (error) {
      this.logger.error('Failed to start daily analytics cron job', error);
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleSalesforceUpdateCron() {
    this.logger.log('Checking for pending Salesforce updates...');
    const batchKey = 'salesforce-update-batch';

    if (this.isSalesforceUpdateRunning) {
      this.logger.warn('Salesforce update is already in progress. Skipping this run.');
      return;
    }

    this.isSalesforceUpdateRunning = true;
    try {
      const batchSize = await this.redis.llen(batchKey);
      if (batchSize === 0) {
        this.logger.log('No pending updates for Salesforce.');
        return;
      }

      this.logger.log(`Found ${batchSize} completed user analytics to push to Salesforce.`);

       const pipeline = this.redis.pipeline();
      pipeline.lrange(batchKey, 0, -1);
      pipeline.ltrim(batchKey, 1, 0);
      const execResult = await pipeline.exec();
      if (!execResult || !execResult[0] || execResult[0][0]) {
        this.logger.error('Redis pipeline failed to retrieve batch for Salesforce update.');
        return;
      }

      const results = execResult[0][1] as string[];
      const updates: Top10UpdatePayload[] = results.map(res => JSON.parse(res) as Top10UpdatePayload);

      await this.salesforceService.bulkUpdateTop10Merchants(updates);
      this.logger.log(`Successfully pushed ${updates.length} updates to Salesforce.`);

    } catch (error) {
      this.logger.error('Failed to process Salesforce update batch.', error);
    } finally {
      this.isSalesforceUpdateRunning = false;
    }
  }
}