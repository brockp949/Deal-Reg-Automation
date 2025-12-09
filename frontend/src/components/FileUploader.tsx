import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, File, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { fileAPI, configAPI } from '@/lib/api';
import { formatFileSize, getFileIcon } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import type { SourceFile, ConfigSnapshot } from '@/types';

const ALLOWED_TYPES = {
  'application/mbox': ['.mbox'],
  'text/csv': ['.csv'],
  'text/plain': ['.txt'],
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/json': ['.json'],
};

interface SecurityMetrics {
  scanStatus: Record<string, number>;
  blockedCount: number;
  quarantinedCount: number;
  duplicateEventsLast30Days: number;
}

interface ConfigMetrics {
  totalSnapshots: number;
  appliedSnapshots: number;
  pendingSnapshots: number;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB (5368709120 bytes)

export default function FileUploader() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const queryClient = useQueryClient();

  // Fetch uploaded files with auto-refresh for processing files
  const { data: uploadedFiles, isLoading } = useQuery({
    queryKey: ['files'],
    queryFn: async () => {
      const response = await fileAPI.getAll();
      if (!response.data.success) return [];
      return response.data.data.data as SourceFile[];
    },
    refetchInterval: (query) => {
      // Auto-refresh every 2 seconds if any file is processing or pending
      const files = query.state.data;
      const hasProcessing = files?.some((file: SourceFile) =>
        file.processing_status === 'processing' || file.processing_status === 'pending'
      );
      return hasProcessing ? 2000 : false;
    },
  });

  const { data: securityMetrics } = useQuery({
    queryKey: ['files', 'metrics', 'security'],
    queryFn: async () => {
      const response = await fileAPI.getSecurityMetrics();
      if (!response.data.success) return null;
      return response.data.data as SecurityMetrics;
    },
    refetchInterval: 15000,
  });

  const { data: configMetrics } = useQuery({
    queryKey: ['configs', 'metrics'],
    queryFn: async () => {
      const response = await configAPI.getMetrics();
      if (!response.data.success) return null;
      return response.data.data as ConfigMetrics;
    },
    refetchInterval: 30000,
  });

  const { data: configSnapshots, isLoading: snapshotsLoading } = useQuery({
    queryKey: ['configs', 'snapshots'],
    queryFn: async () => {
      const response = await configAPI.getSnapshots({ limit: 5 });
      if (!response.data.success) return [];
      return response.data.data.data as ConfigSnapshot[];
    },
    refetchInterval: 15000,
  });

  const applySnapshotMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      return await configAPI.applySnapshot(id, { appliedBy: 'Skip Ops UI', notes });
    },
    onSuccess: () => {
      toast.success('Config snapshot applied');
      queryClient.invalidateQueries({ queryKey: ['configs', 'snapshots'] });
      queryClient.invalidateQueries({ queryKey: ['configs', 'metrics'] });
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to apply snapshot');
    },
  });

  const handleApplySnapshot = (snapshotId: string) => {
    applySnapshotMutation.mutate({ id: snapshotId });
  };

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      // Simple progress handler - we could track this more granularly
      const onProgress = () => {};
      if (files.length === 1) {
        return await fileAPI.upload(files[0], onProgress);
      } else {
        return await fileAPI.batchUpload(files, onProgress);
      }
    },
    onSuccess: (response: any) => {
      const message = response?.data?.message || 'Files uploaded successfully';
      toast.success(message);
      setSelectedFiles([]);
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to upload files');
    },
  });

  // Delete file mutation
  const deleteMutation = useMutation({
    mutationFn: async (fileId: string) => {
      return await fileAPI.delete(fileId);
    },
    onSuccess: () => {
      toast.success('File deleted');
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to delete file');
    },
  });

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: any[]) => {
    if (rejectedFiles.length > 0) {
      rejectedFiles.forEach((file) => {
        const error = file.errors[0];
        if (error.code === 'file-too-large') {
          toast.error(`${file.file.name} is too large. Max size is 5GB.`);
        } else if (error.code === 'file-invalid-type') {
          toast.error(`${file.file.name} has an invalid file type.`);
        } else {
          toast.error(`${file.file.name}: ${error.message}`);
        }
      });
    }

    if (acceptedFiles.length > 0) {
      setSelectedFiles((prev) => [...prev, ...acceptedFiles]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ALLOWED_TYPES,
    maxSize: MAX_FILE_SIZE,
    multiple: true,
  });

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = () => {
    if (selectedFiles.length === 0) {
      toast.error('Please select files to upload');
      return;
    }
    uploadMutation.mutate(selectedFiles);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="success">Completed</Badge>;
      case 'processing':
        return <Badge variant="warning">Processing</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      case 'blocked':
        return <Badge variant="outline">Blocked</Badge>;
      default:
        return <Badge variant="secondary">Pending</Badge>;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'processing':
        return <Loader2 className="h-5 w-5 text-amber-500 animate-spin" />;
      case 'failed':
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      case 'blocked':
        return <AlertCircle className="h-5 w-5 text-amber-500" />;
      default:
        return <File className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getScanBadge = (scanStatus?: string) => {
    if (!scanStatus || scanStatus === 'not_scanned') return null;

    switch (scanStatus) {
      case 'passed':
        return <Badge variant="success">Scan Passed</Badge>;
      case 'failed':
        return <Badge variant="destructive">Scan Failed</Badge>;
      case 'error':
        return <Badge variant="destructive">Scan Error</Badge>;
      case 'pending':
        return <Badge variant="warning">Scan Pending</Badge>;
      default:
        return <Badge variant="secondary">Scan Unknown</Badge>;
    }
  };

  const formatChecksum = (value?: string) => {
    if (!value) return null;
    return `${value.slice(0, 12)}…${value.slice(-4)}`;
  };

  return (
    <div className="space-y-8">
      {/* Upload Zone */}
      <Card className="p-6">
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
            isDragActive
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-primary/50'
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">
            {isDragActive ? 'Drop files here' : 'Drag & drop files here'}
          </h2>
          <p className="text-muted-foreground mb-4">or click to browse</p>
          <p className="text-sm text-muted-foreground">
            Supported: .mbox, .txt, .pdf, .docx, .csv, .json
          </p>
          <p className="text-sm text-muted-foreground">Max size: 500MB per file</p>
        </div>

        {/* Selected Files */}
        {selectedFiles.length > 0 && (
          <div className="mt-6">
            <h3 className="text-lg font-semibold mb-3">Files to Upload</h3>
            <div className="space-y-2">
              {selectedFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-2xl">{getFileIcon(file.type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{file.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeFile(index)}
                    disabled={uploadMutation.isPending}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex gap-3 mt-4">
              <Button
                onClick={handleUpload}
                disabled={uploadMutation.isPending}
                className="flex-1"
              >
                {uploadMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Upload {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setSelectedFiles([])}
                disabled={uploadMutation.isPending}
              >
                Clear All
              </Button>
            </div>
          </div>
        )}
      </Card>

     {/* Uploaded Files List */}
     <div>
        {(securityMetrics || configMetrics) && (
          <div className="grid gap-4 md:grid-cols-2 mb-4">
            {securityMetrics && (
              <Card className="p-4">
                <h3 className="text-sm font-semibold mb-2">Security Snapshot</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Metric label="Passed" value={securityMetrics.scanStatus?.passed ?? 0} />
                  <Metric label="Failed" value={securityMetrics.scanStatus?.failed ?? 0} />
                  <Metric label="Blocked" value={securityMetrics.blockedCount} />
                  <Metric label="Quarantined" value={securityMetrics.quarantinedCount} />
                  <Metric label="Duplicates (30d)" value={securityMetrics.duplicateEventsLast30Days} />
                </div>
              </Card>
            )}
            {configMetrics && (
              <Card className="p-4">
                <h3 className="text-sm font-semibold mb-2">Config Uploads</h3>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <Metric label="Total" value={configMetrics.totalSnapshots} />
                  <Metric label="Applied" value={configMetrics.appliedSnapshots} />
                  <Metric label="Pending" value={configMetrics.pendingSnapshots} />
                </div>
              </Card>
            )}
          </div>
        )}
        {configSnapshots && configSnapshots.length > 0 && (
          <Card className="p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Recent Config Snapshots</h3>
              {snapshotsLoading && (
                <span className="text-xs text-muted-foreground">Refreshing…</span>
              )}
            </div>
            <div className="space-y-3">
              {configSnapshots.map((snapshot) => (
                <div
                  key={snapshot.id}
                  className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border rounded-md p-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{snapshot.config_name}</p>
                      {snapshot.applied_at ? (
                        <Badge variant="success">Applied</Badge>
                      ) : (
                        <Badge variant="secondary">Pending</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Stored {new Date(snapshot.created_at).toLocaleString()} ·{' '}
                      {snapshot.metadata?.keyCount ?? 0} keys
                    </p>
                    {snapshot.metadata?.topLevelKeys?.length ? (
                      <p className="text-xs text-muted-foreground">
                        Keys: {snapshot.metadata.topLevelKeys.slice(0, 4).join(', ')}
                      </p>
                    ) : null}
                    {snapshot.metadata?.intent && (
                      <p className="text-xs text-muted-foreground">
                        Intent: {snapshot.metadata.intent}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {snapshot.applied_at ? (
                      <p className="text-xs text-muted-foreground">
                        Applied {new Date(snapshot.applied_at).toLocaleString()}
                      </p>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleApplySnapshot(snapshot.id)}
                        disabled={applySnapshotMutation.isPending}
                      >
                        {applySnapshotMutation.isPending ? 'Applying…' : 'Mark Applied'}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <h2 className="text-2xl font-bold mb-4">Uploaded Files</h2>
        <Card className="p-6">
          {isLoading ? (
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
              <p className="mt-2 text-muted-foreground">Loading files...</p>
            </div>
          ) : !uploadedFiles || uploadedFiles.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No files uploaded yet
            </div>
          ) : (
            <div className="space-y-3">
              {uploadedFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-4 flex-1">
                    {getStatusIcon(file.processing_status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{file.filename}</p>
                        {getStatusBadge(file.processing_status)}
                      </div>
                      <div className="flex gap-4 mt-1 text-sm text-muted-foreground">
                        <span>{formatFileSize(file.file_size)}</span>
                        <span>•</span>
                        <span>{new Date(file.upload_date).toLocaleDateString()}</span>
                        <span>•</span>
                        <span className="capitalize">{file.file_type}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-2 text-xs">
                        {getScanBadge(file.scan_status)}
                        {file.checksum_sha256 && (
                          <span className="font-mono text-muted-foreground">
                            SHA-256 {formatChecksum(file.checksum_sha256)}
                          </span>
                        )}
                        {file.upload_metadata?.intent && (
                          <span className="text-muted-foreground">
                            Intent: {file.upload_metadata.intent}
                          </span>
                        )}
                        {file.uploaded_by && (
                          <span className="text-muted-foreground">
                            By {file.uploaded_by}
                          </span>
                        )}
                        {file.metadata?.config && (
                          <Badge variant="outline">
                            Config {file.metadata.config.configName}
                          </Badge>
                        )}
                      </div>
                      {file.metadata?.config && file.metadata.config.storedAt && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Stored {new Date(file.metadata.config.storedAt).toLocaleString()} ·{' '}
                          {file.metadata.config.topLevelKeys?.slice(0, 3).join(', ')}
                        </p>
                      )}
                      {file.quarantine_reason && (
                        <p className="text-xs text-destructive mt-1">
                          Quarantined: {file.quarantine_reason}
                        </p>
                      )}
                      {(file.processing_status === 'processing' || file.processing_status === 'pending') && (
                        <div className="mt-2">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs text-muted-foreground">
                              {file.processing_status === 'pending' ? 'Queued...' : 'Processing...'}
                            </span>
                            <span className="text-xs font-medium">
                              {file.metadata?.progress || 0}%
                            </span>
                          </div>
                          <Progress value={file.metadata?.progress || 0} className="h-2" />
                        </div>
                      )}
                      {file.error_message && (
                        <p className="text-sm text-destructive mt-1">
                          Error: {file.error_message}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteMutation.mutate(file.id)}
                      disabled={deleteMutation.isPending || file.processing_status === 'processing' || file.processing_status === 'pending'}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
