import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class RcloneClient {
  private remote: string;

  constructor(remote: string) {
    this.remote = remote;
  }

  async sync(source: string, destination: string): Promise<void> {
    const command = `rclone sync "${source}" "${destination}" --progress`;
    await execAsync(command);
  }

  async copy(source: string, destination: string): Promise<void> {
    const command = `rclone copy "${source}" "${destination}"`;
    await execAsync(command);
  }

  async listRemotes(): Promise<string[]> {
    const { stdout } = await execAsync('rclone listremotes');
    return stdout.split('\n').filter(r => r.trim());
  }
}