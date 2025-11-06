import { Router, Request, Response } from 'express';
import multer from 'multer';
import { join } from 'path';
import { mkdir, readdir, unlink, stat } from 'fs/promises';
import { query } from '../db';
import { config } from '../config';
import { getFileType, isValidFileType, isValidFileSize, generateUniqueFilename } from '../utils/fileHelpers';
import { ApiResponse, SourceFile } from '../types';
import logger from '../utils/logger';

const router = Router();

// Ensure upload directory exists
mkdir(config.upload.directory, { recursive: true }).catch((err) =>
  logger.error('Failed to create upload directory', err)
);

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.upload.directory);
  },
  filename: (req, file, cb) => {
    const uniqueFilename = generateUniqueFilename(file.originalname);
    cb(null, uniqueFilename);
  },
});

// Multer upload middleware
const upload = multer({
  storage,
  limits: {
    fileSize: config.upload.maxFileSize,
  },
  fileFilter: (req, file, cb) => {
    if (!isValidFileType(file.originalname)) {
      return cb(new Error(`Invalid file type. Allowed types: ${config.upload.allowedTypes.join(', ')}`));
    }
    cb(null, true);
  },
});

/**
 * POST /api/files/upload
 * Upload a single file
 */
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    const fileType = getFileType(req.file.originalname);
    const storagePath = join(config.upload.directory, req.file.filename);

    // Save file metadata to database
    const result = await query(
      `INSERT INTO source_files (filename, file_type, file_size, storage_path, processing_status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.file.originalname, fileType, req.file.size, storagePath, 'pending']
    );

    const sourceFile: SourceFile = result.rows[0];

    logger.info('File uploaded successfully', {
      fileId: sourceFile.id,
      filename: sourceFile.filename,
      size: sourceFile.file_size,
    });

    // Automatically queue the file for processing
    const { addFileProcessingJob } = await import('../queues/fileProcessingQueue');
    const job = await addFileProcessingJob(sourceFile.id);

    logger.info('File queued for processing', {
      fileId: sourceFile.id,
      jobId: job.id,
    });

    const response: ApiResponse<SourceFile> = {
      success: true,
      data: sourceFile,
      message: 'File uploaded and queued for processing',
    };

    res.status(201).json(response);
  } catch (error: any) {
    logger.error('Error uploading file', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to upload file',
    });
  }
});

/**
 * POST /api/files/batch-upload
 * Upload multiple files
 */
router.post('/batch-upload', upload.array('files', 10), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded',
      });
    }

    const uploadedFiles: SourceFile[] = [];
    const { addFileProcessingJob } = await import('../queues/fileProcessingQueue');

    for (const file of files) {
      const fileType = getFileType(file.originalname);
      const storagePath = join(config.upload.directory, file.filename);

      const result = await query(
        `INSERT INTO source_files (filename, file_type, file_size, storage_path, processing_status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [file.originalname, fileType, file.size, storagePath, 'pending']
      );

      const sourceFile: SourceFile = result.rows[0];
      uploadedFiles.push(sourceFile);

      // Automatically queue each file for processing
      const job = await addFileProcessingJob(sourceFile.id);
      logger.info('File queued for processing', {
        fileId: sourceFile.id,
        jobId: job.id,
      });
    }

    logger.info('Batch upload completed and queued', { count: uploadedFiles.length });

    res.status(201).json({
      success: true,
      data: uploadedFiles,
      message: `${uploadedFiles.length} files uploaded and queued for processing`,
    });
  } catch (error: any) {
    logger.error('Error in batch upload', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to upload files',
    });
  }
});

/**
 * GET /api/files
 * Get all uploaded files
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, file_type, limit = '50' } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    if (status) {
      conditions.push(`processing_status = $${paramCount++}`);
      params.push(status);
    }

    if (file_type) {
      conditions.push(`file_type = $${paramCount++}`);
      params.push(file_type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(parseInt(limit as string, 10));
    const result = await query(
      `SELECT * FROM source_files ${whereClause}
       ORDER BY upload_date DESC
       LIMIT $${paramCount}`,
      params
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    logger.error('Error fetching files', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch files',
    });
  }
});

/**
 * GET /api/files/:id
 * Get file details by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query('SELECT * FROM source_files WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'File not found',
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    logger.error('Error fetching file', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch file',
    });
  }
});

/**
 * DELETE /api/files/clear-all
 * Clear all data and files from the system (use with caution!)
 */
router.delete('/clear-all', async (req: Request, res: Response) => {
  try {
    logger.warn('Clear all data operation initiated');

    // Step 1: Delete all records from tables (in reverse order of dependencies)
    const deleteStats = {
      contacts: 0,
      deals: 0,
      vendors: 0,
      sourceFiles: 0,
      filesDeleted: 0,
      errors: [] as string[],
    };

    // Delete contacts (depends on vendors)
    const contactsResult = await query('DELETE FROM contacts RETURNING id');
    deleteStats.contacts = contactsResult.rowCount || 0;
    logger.info(`Deleted ${deleteStats.contacts} contacts`);

    // Delete deals (depends on vendors and source_files)
    const dealsResult = await query('DELETE FROM deal_registrations RETURNING id');
    deleteStats.deals = dealsResult.rowCount || 0;
    logger.info(`Deleted ${deleteStats.deals} deals`);

    // Delete vendors
    const vendorsResult = await query('DELETE FROM vendors RETURNING id');
    deleteStats.vendors = vendorsResult.rowCount || 0;
    logger.info(`Deleted ${deleteStats.vendors} vendors`);

    // Get all source files before deleting
    const sourceFilesResult = await query('SELECT storage_path FROM source_files');
    const filePaths = sourceFilesResult.rows.map((row: any) => row.storage_path);

    // Delete source_files from database
    const sourceFilesDeleteResult = await query('DELETE FROM source_files RETURNING id');
    deleteStats.sourceFiles = sourceFilesDeleteResult.rowCount || 0;
    logger.info(`Deleted ${deleteStats.sourceFiles} source file records`);

    // Step 2: Delete physical files from uploads directory
    try {
      // Delete individual tracked files
      for (const filePath of filePaths) {
        try {
          await unlink(filePath);
          deleteStats.filesDeleted++;
        } catch (err: any) {
          if (err.code !== 'ENOENT') {
            // Ignore "file not found" errors
            deleteStats.errors.push(`Failed to delete ${filePath}: ${err.message}`);
          }
        }
      }

      // Also clean up any remaining files in uploads directory
      try {
        const files = await readdir(config.upload.directory);
        for (const file of files) {
          const filePath = join(config.upload.directory, file);
          try {
            const stats = await stat(filePath);
            if (stats.isFile()) {
              await unlink(filePath);
              deleteStats.filesDeleted++;
            }
          } catch (err: any) {
            deleteStats.errors.push(`Failed to delete ${file}: ${err.message}`);
          }
        }
      } catch (err: any) {
        deleteStats.errors.push(`Failed to read upload directory: ${err.message}`);
      }

      logger.info(`Deleted ${deleteStats.filesDeleted} physical files`);
    } catch (err: any) {
      logger.error('Error deleting physical files', { error: err.message });
      deleteStats.errors.push(`File deletion error: ${err.message}`);
    }

    // Step 3: Clear Redis queues (optional)
    try {
      const { fileProcessingQueue } = await import('../queues/fileProcessingQueue');
      await fileProcessingQueue.obliterate({ force: true });
      logger.info('Cleared file processing queue');
    } catch (err: any) {
      logger.warn('Failed to clear Redis queues', { error: err.message });
      // Non-critical, don't add to errors
    }

    logger.warn('Clear all data operation completed', deleteStats);

    res.json({
      success: true,
      message: 'All data and files cleared successfully',
      data: deleteStats,
    });
  } catch (error: any) {
    logger.error('Error clearing data', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to clear data',
      details: error.message,
    });
  }
});

/**
 * DELETE /api/files/:id
 * Delete a file
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query('DELETE FROM source_files WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'File not found',
      });
    }

    // TODO: Delete physical file from storage

    res.json({
      success: true,
      message: 'File deleted successfully',
    });
  } catch (error: any) {
    logger.error('Error deleting file', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to delete file',
    });
  }
});

/**
 * POST /api/files/:id/process
 * Trigger file processing
 */
router.post('/:id/process', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if file exists
    const fileResult = await query('SELECT * FROM source_files WHERE id = $1', [id]);

    if (fileResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'File not found',
      });
    }

    const file: SourceFile = fileResult.rows[0];

    if (file.processing_status === 'processing') {
      return res.status(400).json({
        success: false,
        error: 'File is already being processed',
      });
    }

    // Add file to processing queue
    const { addFileProcessingJob } = await import('../queues/fileProcessingQueue');
    const job = await addFileProcessingJob(id);

    res.json({
      success: true,
      message: 'File processing queued',
      data: {
        jobId: job.id,
      },
    });
  } catch (error: any) {
    logger.error('Error processing file', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to start file processing',
    });
  }
});

export default router;
