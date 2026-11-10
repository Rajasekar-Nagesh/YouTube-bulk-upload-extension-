export type UploadStatus = 'queued' | 'uploading' | 'uploaded' | 'failed' | 'skipped';

export interface VideoJob {
  key: string;
  filename: string;
  title: string;
  description: string;
  tags: string[];
  publishAt: string;
  status: UploadStatus;
  progress: number;
  videoId?: string;
  error?: string;
  resumableUrl?: string;
  bytesSent?: number;
}