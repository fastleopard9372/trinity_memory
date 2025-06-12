import { z } from 'zod';

/**
 * Validate UUID
 */
export const isValidUUID = (uuid: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

/**
 * Validate file path
 */
export const isValidFilePath = (path: string): boolean => {
  // Prevent directory traversal
  if (path.includes('..') || path.includes('~')) {
    return false;
  }
  
  // Must start with /
  if (!path.startsWith('/')) {
    return false;
  }
  
  // Check for valid characters
  const validPathRegex = /^[a-zA-Z0-9/_\-\.]+$/;
  return validPathRegex.test(path);
};

/**
 * Validate date range
 */
export const validateDateRange = (start: Date, end: Date): boolean => {
  return start <= end && end <= new Date();
};

/**
 * Sanitize filename
 */
export const sanitizeFilename = (filename: string): string => {
  return filename
    .replace(/[^a-zA-Z0-9_\-\.]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase();
};