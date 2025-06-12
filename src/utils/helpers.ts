import { createHash } from 'crypto';
import * as path from 'path';

/**
 * Generate file hash
 */
export const generateFileHash = (content: string): string => {
  return createHash('sha256').update(content).digest('hex');
};

/**
 * Format file size
 */
export const formatFileSize = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
};

/**
 * Extract file extension
 */
export const getFileExtension = (filename: string): string => {
  return path.extname(filename).toLowerCase();
};

/**
 * Build pagination response
 */
export const buildPaginationResponse = (
  data: any[],
  total: number,
  limit: number,
  offset: number
) => {
  return {
    data,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
      pages: Math.ceil(total / limit),
      currentPage: Math.floor(offset / limit) + 1,
    },
  };
};

/**
 * Parse sort parameters
 */
export const parseSortParams = (
  sortBy?: string,
  order?: string
): { field: string; direction: 'asc' | 'desc' } => {
  const validSortFields = [
    'createdAt',
    'modifiedAt',
    'fileSize',
    'messageCount',
    'title',
  ];
  
  const field = validSortFields.includes(sortBy || '') ? sortBy! : 'createdAt';
  const direction = order === 'asc' ? 'asc' : 'desc';
  
  return { field, direction };
};