/**
 * Chunked Upload Progress Component
 *
 * Displays visual progress for chunked file uploads with:
 * - Progress bar
 * - Upload speed
 * - Estimated time remaining
 * - Chunk-level details
 * - Cancel button
 */

import React from 'react';
import { ChunkedUploadProgress as ProgressData } from '../../hooks/useChunkedUpload';

interface ChunkedUploadProgressProps {
  progress: ProgressData;
  fileName: string;
  onCancel?: () => void;
  showDetails?: boolean;
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Format speed (bytes/sec) to human-readable
 */
function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return '0 B/s';

  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));

  return `${(bytesPerSecond / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Format seconds to human-readable time
 */
function formatTime(seconds: number): string {
  if (seconds < 1) return 'less than a second';
  if (seconds < 60) return `${Math.round(seconds)} seconds`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);

  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes} min ${remainingSeconds} sec`
      : `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0
    ? `${hours} hr ${remainingMinutes} min`
    : `${hours} hr`;
}

/**
 * Chunked Upload Progress Component
 */
export const ChunkedUploadProgress: React.FC<ChunkedUploadProgressProps> = ({
  progress,
  fileName,
  onCancel,
  showDetails = true,
}) => {
  return (
    <div className="chunked-upload-progress" style={styles.container}>
      {/* File Name */}
      <div style={styles.header}>
        <div style={styles.fileName}>{fileName}</div>
        {onCancel && (
          <button onClick={onCancel} style={styles.cancelButton}>
            Cancel
          </button>
        )}
      </div>

      {/* Progress Bar */}
      <div style={styles.progressBarContainer}>
        <div
          style={{
            ...styles.progressBar,
            width: `${progress.progress}%`,
          }}
        />
      </div>

      {/* Progress Percentage */}
      <div style={styles.progressText}>
        <span style={styles.progressPercentage}>{progress.progress}%</span>
        <span style={styles.progressBytes}>
          {formatBytes(progress.uploadedBytes)} / {formatBytes(progress.totalBytes)}
        </span>
      </div>

      {/* Details */}
      {showDetails && (
        <div style={styles.details}>
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>Chunks:</span>
            <span style={styles.detailValue}>
              {progress.uploadedChunks} / {progress.totalChunks}
            </span>
          </div>

          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>Speed:</span>
            <span style={styles.detailValue}>{formatSpeed(progress.speed)}</span>
          </div>

          {progress.estimatedTimeRemaining > 0 && (
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Time remaining:</span>
              <span style={styles.detailValue}>
                {formatTime(progress.estimatedTimeRemaining)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Inline styles (can be moved to CSS if preferred)
const styles = {
  container: {
    padding: '16px',
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
  } as React.CSSProperties,

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  } as React.CSSProperties,

  fileName: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#111827',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,

  cancelButton: {
    padding: '4px 12px',
    fontSize: '13px',
    color: '#dc2626',
    backgroundColor: 'transparent',
    border: '1px solid #dc2626',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  } as React.CSSProperties,

  progressBarContainer: {
    width: '100%',
    height: '8px',
    backgroundColor: '#e5e7eb',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '8px',
  } as React.CSSProperties,

  progressBar: {
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: '4px',
    transition: 'width 0.3s ease',
  } as React.CSSProperties,

  progressText: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  } as React.CSSProperties,

  progressPercentage: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#3b82f6',
  } as React.CSSProperties,

  progressBytes: {
    fontSize: '13px',
    color: '#6b7280',
  } as React.CSSProperties,

  details: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    paddingTop: '12px',
    borderTop: '1px solid #e5e7eb',
  } as React.CSSProperties,

  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
  } as React.CSSProperties,

  detailLabel: {
    color: '#6b7280',
  } as React.CSSProperties,

  detailValue: {
    color: '#111827',
    fontWeight: 500,
  } as React.CSSProperties,
};

export default ChunkedUploadProgress;
