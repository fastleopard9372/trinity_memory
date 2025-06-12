import { Request, Response, NextFunction } from 'express';
import { NASService } from '../services/nas/nas.service';
import { FileIndexer } from '../services/indexer/file.indexer';

export class FileController {
  private nas: NASService;
  private indexer: FileIndexer;

  constructor(nas: NASService, indexer: FileIndexer) {
    this.nas = nas;
    this.indexer = indexer;
  }

  /**
   * Upload file to NAS
   */
  uploadFile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { path, content, type } = req.body;
      const userId = req.user.id;

      if (!path || !content) {
        return res.status(400).json({
          error: 'Path and content are required',
        });
      }

      // Build user-specific path
      const fullPath = NASService.buildUserPath(
        userId,
        type || 'uploads',
        path
      );

      // Write to NAS
      await this.nas.writeFile(fullPath, content);

      // Index the file
      await this.indexer.indexFile(fullPath, userId);

      res.json({
        success: true,
        data: {
          path: fullPath,
          indexed: true,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * List files in directory
   */
  listFiles = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { directory = '/' } = req.query;
      const userId = req.user.id;

      // Build user-specific path
      const userPath = `/trinity/users/${userId}${directory}`;

      const files = await this.nas.listDirectory(userPath);

      res.json({
        success: true,
        data: files,
        path: userPath,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Re-index file
   */
  reindexFile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { path } = req.body;
      const userId = req.user.id;

      if (!path) {
        return res.status(400).json({
          error: 'File path is required',
        });
      }

      await this.indexer.indexFile(path, userId);

      res.json({
        success: true,
        message: 'File re-indexed successfully',
      });
    } catch (error) {
      next(error);
    }
  };
}