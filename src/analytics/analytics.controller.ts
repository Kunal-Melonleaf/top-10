import { Controller, Post, Body, Get, Param, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.provider';

@Controller('analytics')
export class AnalyticsController {
  constructor(
    @InjectQueue('user-analytics') private readonly userAnalyticsQueue: Queue,
    @InjectQueue('finalization') private readonly finalizationQueue: Queue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Post('trigger')
  async triggerUserAnalysis(@Body() body: { userId: string, portalId: string }) {
    const { userId, portalId } = body;
    const lockKey = `analytics-status:${userId}`;
    const twelveHoursInSeconds = 12 * 60 * 60;

    const lockAcquired = await this.redis.set(lockKey, 'queued', 'EX', twelveHoursInSeconds, 'NX');

    if (!lockAcquired) {
      const currentState = await this.redis.get(lockKey);
      throw new HttpException(
        `An analytics job for this user is already in progress with status: ${currentState || 'unknown'}.`,
        HttpStatus.CONFLICT,
      );
    }

    const job = await this.userAnalyticsQueue.add('process-user', { userId, portalId });

    return { message: 'Analytics job queued successfully.', jobId: job.id };
  }

  @Get('status/:jobId')
  async getJobStatus(@Param('jobId') jobId: string) {
    const job = await this.userAnalyticsQueue.getJob(jobId);
    if (!job) {
      throw new HttpException('Job not found', HttpStatus.NOT_FOUND);
    }
    const state = await job.getState();
 const progress = job.progress || 0; 
    return { jobId, state, progress };
  }

    @Get('debug/flow/:jobId')
  async inspectFlow(@Param('jobId') jobId: string) {
    const job = await this.finalizationQueue.getJob(jobId);

    if (!job) {
      return { status: 'Job Not Found' };
    }

    // Minimal, safe properties
    const state = await job.getState();
    
    // Attempt to get return value (if completed)
    let returnvalue = null;
    try { returnvalue = job.returnvalue; } catch (e) {console.error(e); }

    return {
      jobId: job.id,
      state: state,
      failedReason: job.failedReason,
      stacktrace: job.stacktrace,
      returnvalue: returnvalue,
      // Manually check if it looks like it's waiting
      isStuck: state === 'active' || state === 'waiting-children'
    };
  }
}