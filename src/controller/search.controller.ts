import { Request, Response, NextFunction } from 'express';
import { SearchService } from '../services/search/search.service';

export class SearchController {
  private searchService: SearchService;

  constructor(searchService: SearchService) {
    this.searchService = searchService;
  }

  /**
   * Search memories
   */
  search = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { q, query } = req.query;
      const searchQuery = (q || query) as string;
      const userId = req.user.id;

      if (!searchQuery) {
        return res.status(400).json({
          error: 'Query parameter is required',
        });
      }

      const options = {
        limit: Number(req.query.limit) || 10,
        offset: Number(req.query.offset) || 0,
        fileTypes: req.query.fileTypes as string[],
        tags: req.query.tags as string[],
        dateRange: req.query.startDate && req.query.endDate ? {
          start: new Date(req.query.startDate as string),
          end: new Date(req.query.endDate as string),
        } : undefined,
      };

      const results = await this.searchService.search(
        searchQuery,
        userId,
        options
      );

      res.json({
        success: true,
        data: results,
        query: searchQuery,
        count: results.length,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get file by path
   */
  getFileByPath = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { path } = req.body;
      const userId = req.user.id;

      if (!path) {
        return res.status(400).json({
          error: 'File path is required',
        });
      }

      const result = await this.searchService.getFileByPath(path, userId);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
}