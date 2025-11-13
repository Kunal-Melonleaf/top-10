
export interface VolumeAndCount {
  netVolume: number;
  transactionCount: number;
}

export interface IProcessorService {
  calculateVolumeAndCount(
    merchantId: string,
    processorName: string,
    dateScope: { from: string | null },
  ): Promise<VolumeAndCount>;
}

// Helper types for raw API responses
export interface IrisRawTransaction {
  date: string;
  amount: string;
  type:  string;
}

export interface IrisRawBatch {
  transactions: IrisRawTransaction[];
}

export interface PayrocRawBatch {
  batchId: number;
  saleAmount?: number;
  returnAmount?: number;
  transactionCount?: number;
}