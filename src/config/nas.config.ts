import { NASConfig } from '../services/nas/nas.service';

export const getNASConfig = (): NASConfig => {
  return {
    type: process.env.NAS_TYPE as 'webdav' | 'smb' | 'rclone',
    baseUrl: process.env.NAS_URL!,
    mountPath: process.env.NAS_MOUNT_PATH!,
    credentials: {
      username: process.env.NAS_USERNAME!,
      password: process.env.NAS_PASSWORD!,
    },
  };
};