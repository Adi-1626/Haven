import path from 'node:path';
import fs from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface DownloadInfo {
  type: 'local' | 'redirect';
  filePath?: string;
  url?: string;
}

export interface StorageService {
  isSupabase: boolean;
  upload(bucket: string, diskName: string, buffer: Buffer, mime?: string): Promise<void>;
  getDownloadInfo(bucket: string, diskName: string, filename?: string): Promise<DownloadInfo>;
  remove(bucket: string, diskName: string): Promise<void>;
}

export class LocalStorageService implements StorageService {
  public isSupabase = false;
  private uploadDir: string;

  constructor(uploadDir: string) {
    this.uploadDir = uploadDir;
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  async upload(_bucket: string, diskName: string, buffer: Buffer, _mime?: string): Promise<void> {
    const target = path.join(this.uploadDir, path.basename(diskName));
    fs.writeFileSync(target, buffer, { flag: 'wx' });
  }

  async getDownloadInfo(_bucket: string, diskName: string, _filename?: string): Promise<DownloadInfo> {
    return {
      type: 'local',
      filePath: path.resolve(this.uploadDir, path.basename(diskName)),
    };
  }

  async remove(_bucket: string, diskName: string): Promise<void> {
    try {
      fs.unlinkSync(path.join(this.uploadDir, path.basename(diskName)));
    } catch {}
  }
}

export class SupabaseStorageService implements StorageService {
  public isSupabase = true;
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async upload(bucket: string, diskName: string, buffer: Buffer, mime: string = 'application/octet-stream'): Promise<void> {
    const { error } = await this.supabase.storage.from(bucket).upload(diskName, buffer, {
      contentType: mime,
      upsert: true,
    });
    if (error) throw new Error(`Supabase storage upload failed: ${error.message}`);
  }

  async getDownloadInfo(bucket: string, diskName: string, filename?: string): Promise<DownloadInfo> {
    const { data, error } = await this.supabase.storage.from(bucket).createSignedUrl(
      diskName,
      3600, // 1 hour valid
      filename ? { download: filename } : undefined
    );
    if (error || !data?.signedUrl) {
      throw new Error(`Failed to generate signed storage URL: ${error?.message || 'Unknown error'}`);
    }
    return {
      type: 'redirect',
      url: data.signedUrl,
    };
  }

  async remove(bucket: string, diskName: string): Promise<void> {
    const { error } = await this.supabase.storage.from(bucket).remove([diskName]);
    if (error) {
      console.warn(`Supabase storage removal error for ${bucket}/${diskName}:`, error.message);
    }
  }
}

export function createStorage(options: {
  uploadDir?: string;
  supabaseUrl?: string;
  supabaseServiceKey?: string;
}): StorageService {
  const isHosted = process.env.HAVEN_MODE === 'hosted' || (process.env.NODE_ENV === 'production' && !options.uploadDir && !process.env.DATA_DIR);
  const supabaseUrl = options.supabaseUrl || process.env.SUPABASE_URL;
  const serviceKey = options.supabaseServiceKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (supabaseUrl && serviceKey) {
    return new SupabaseStorageService(supabaseUrl, serviceKey);
  }
  if (isHosted) {
    throw new Error('FATAL: Hosted mode requires valid Supabase Storage configuration (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY). Silent fallback to local storage is strictly forbidden in hosted mode.');
  }
  return new LocalStorageService(options.uploadDir || path.resolve('data', 'uploads'));
}
