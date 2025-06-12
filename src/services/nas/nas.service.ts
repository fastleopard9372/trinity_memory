import { createClient, FileStat, WebDAVClient } from 'webdav';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { logger } from '../../utils/logger';

const execAsync = promisify(exec);

export interface NASConfig {
  type: 'webdav' | 'smb' | 'rclone';
  baseUrl: string;
  mountPath: string;
  credentials: {
    username: string;
    password: string;
  };
}

export interface FileInfo {
  path: string;
  size: number;
  modified: Date;
  isDirectory: boolean;
}

export class NASService {
  private webdav?: WebDAVClient;
  private config: NASConfig;

  constructor(config: NASConfig) {
    this.config = config;
    
    if (config.type === 'webdav') {
      this.webdav = createClient(config.baseUrl, {
        username: config.credentials.username,
        password: config.credentials.password
      });
    }
  }

  /**
   * Read file content from NAS using appropriate method
   */
  async readFile(filePath: string): Promise<string> {
    logger.info(`Reading file from NAS: ${filePath}`);
    
    try {
      switch (this.config.type) {
        case 'webdav':
          return await this.readViaWebDAV(filePath);
        case 'smb':
          return await this.readViaSMB(filePath);
        case 'rclone':
          return await this.readViaRclone(filePath);
        default:
          throw new Error(`Unsupported NAS type: ${this.config.type}`);
      }
    } catch (error) {
      logger.error(`Failed to read file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Write file to NAS
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    logger.info(`Writing file to NAS: ${filePath}`);
    
    // Ensure directory exists
    await this.ensureDirectory(path.dirname(filePath));
    
    try {
      switch (this.config.type) {
        case 'webdav':
          await this.writeViaWebDAV(filePath, content);
          break;
        case 'smb':
          await this.writeViaSMB(filePath, content);
          break;
        case 'rclone':
          await this.writeViaRclone(filePath, content);
          break;
      }
    } catch (error) {
      logger.error(`Failed to write file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * List directory contents
   */
  async listDirectory(dirPath: string): Promise<FileInfo[]> {
    switch (this.config.type) {
      case 'webdav':
        return await this.listViaWebDAV(dirPath);
      case 'rclone':
        return await this.listViaRclone(dirPath);
      default:
        throw new Error(`List not implemented for ${this.config.type}`);
    }
  }

  /**
   * Get file stats
   */
  async getFileStats(filePath: string): Promise<FileInfo> {
    if (this.config.type === 'webdav' && this.webdav) {
      const stat = await this.webdav.stat(filePath) as FileStat;
      return {
        path: filePath,
        size: stat.size | stat.size,
        modified: new Date(stat.lastmod),
        isDirectory: stat.type === 'directory',
      };
    }
    
    // For other types, use listing
    const dir = path.dirname(filePath);
    const filename = path.basename(filePath);
    const files = await this.listDirectory(dir);
    const file = files.find(f => path.basename(f.path) === filename);
    
    if (!file) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    return file;
  }

  /**
   * Calculate file checksum
   */
  async getFileChecksum(filePath: string): Promise<string> {
    const content = await this.readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
  }

  // Private methods for WebDAV
  private async readViaWebDAV(filePath: string, format : 'text'|'binary' = 'text'): Promise<string> {
    if (!this.webdav) {
      throw new Error('WebDAV client not initialized');
    }
    
    const content = await this.webdav.getFileContents(filePath, {
      format: format,
    });
    
    return content as string;
  }

  private async writeViaWebDAV(filePath: string, content: string): Promise<void> {
    if (!this.webdav) {
      throw new Error('WebDAV client not initialized');
    }
    
    await this.webdav.putFileContents(filePath, content);
  }

  private async listViaWebDAV(dirPath: string): Promise<FileInfo[]> {
    if (!this.webdav) {
      throw new Error('WebDAV client not initialized');
    }
    
    const contents = await this.webdav.getDirectoryContents(dirPath);

    return (contents as FileStat[]).map((item: FileStat) => ({
      path: item.filename,
      size: item.size,
      modified: new Date(item.lastmod),
      isDirectory: item.type === 'directory',
    }));
  }

  // Private methods for SMB
  private async readViaSMB(filePath: string): Promise<string> {
    const smbPath = `smb://${this.config.baseUrl}${filePath}`;
    const command = `smbclient '${smbPath}' -U '${this.config.credentials.username}%${this.config.credentials.password}' -c 'get "${filePath}" -'`;
    
    const { stdout } = await execAsync(command);
    return stdout;
  }

  private async writeViaSMB(filePath: string, content: string): Promise<void> {
    // Create temp file
    const tempFile = `/tmp/${Date.now()}-${path.basename(filePath)}`;
    await fs.writeFile(tempFile, content);
    
    try {
      const smbPath = `smb://${this.config.baseUrl}${path.dirname(filePath)}`;
      const command = `smbclient '${smbPath}' -U '${this.config.credentials.username}%${this.config.credentials.password}' -c 'put "${tempFile}" "${path.basename(filePath)}"'`;
      
      await execAsync(command);
    } finally {
      // Clean up temp file
      await fs.unlink(tempFile);
    }
  }

  // Private methods for rclone
  private async readViaRclone(filePath: string): Promise<string> {
    const remotePath = `nas:${filePath}`;
    const command = `rclone cat "${remotePath}"`;
    
    const { stdout } = await execAsync(command);
    return stdout;
  }

  private async writeViaRclone(filePath: string, content: string): Promise<void> {
    // Create temp file
    const tempFile = `/tmp/${Date.now()}-${path.basename(filePath)}`;
    await fs.writeFile(tempFile, content);
    
    try {
      const remotePath = `nas:${path.dirname(filePath)}`;
      const command = `rclone copy "${tempFile}" "${remotePath}"`;
      
      await execAsync(command);
    } finally {
      // Clean up temp file
      await fs.unlink(tempFile);
    }
  }

  private async listViaRclone(dirPath: string): Promise<FileInfo[]> {
    const remotePath = `nas:${dirPath}`;
    const command = `rclone lsjson "${remotePath}"`;
    
    const { stdout } = await execAsync(command);
    const items = JSON.parse(stdout);
    
    return items.map((item: any) => ({
      path: path.join(dirPath, item.Name),
      size: item.Size || 0,
      modified: new Date(item.ModTime),
      isDirectory: item.IsDir,
    }));
  }

  /**
   * Ensure directory exists
   */
  private async ensureDirectory(dirPath: string): Promise<void> {
    if (this.config.type === 'webdav' && this.webdav) {
      try {
        await this.webdav.createDirectory(dirPath, { recursive: true });
      } catch (error: any) {
        // Ignore if directory already exists
        if (!error.message?.includes('409')) {
          throw error;
        }
      }
    }
    // For other types, assume directory creation happens automatically
  }

  /**
   * Build full NAS path for user files
   */
  static buildUserPath(userId: string, type: string, filename: string): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    
    return `/trinity/users/${userId}/${type}/${year}/${month}/${filename}`;
  }
}

