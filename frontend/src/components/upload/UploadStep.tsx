import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, File, Loader2, Info } from 'lucide-react';
import { fileAPI } from '@/lib/api';
import { formatFileSize } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';

interface UploadStepProps {
  title: string;
  description: string;
  acceptedFormats: string[];
  helpText?: string;
  onUploadSuccess?: () => void;
}

export default function UploadStep({
  title,
  description,
  acceptedFormats,
  helpText,
  onUploadSuccess,
}: UploadStepProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      if (files.length === 1) {
        return await fileAPI.upload(files[0]);
      } else {
        return await fileAPI.batchUpload(files);
      }
    },
    onSuccess: () => {
      const count = selectedFiles.length;
      toast.success(`Successfully uploaded ${count} file${count > 1 ? 's' : ''}`);
      setSelectedFiles([]);
      queryClient.invalidateQueries({ queryKey: ['files'] });
      onUploadSuccess?.();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to upload files');
    },
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setSelectedFiles(acceptedFiles);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: acceptedFormats.reduce((acc, format) => {
      if (format === '.mbox') {
        acc['application/mbox'] = ['.mbox'];
      } else if (format === '.csv') {
        acc['text/csv'] = ['.csv'];
      } else if (format === '.txt') {
        acc['text/plain'] = ['.txt'];
      } else if (format === '.pdf') {
        acc['application/pdf'] = ['.pdf'];
      }
      return acc;
    }, {} as Record<string, string[]>),
    maxSize: 5 * 1024 * 1024 * 1024, // 5GB
  });

  const handleUpload = () => {
    if (selectedFiles.length > 0) {
      uploadMutation.mutate(selectedFiles);
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles((files) => files.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{title}</h2>
        <p className="text-muted-foreground mt-2">{description}</p>
      </div>

      {helpText && (
        <Card className="p-4 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
          <div className="flex gap-3">
            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-900 dark:text-blue-100">
              {helpText}
            </div>
          </div>
        </Card>
      )}

      <Card className="p-8">
        <div
          {...getRootProps()}
          className={`
            border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors
            ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}
          `}
        >
          <input {...getInputProps()} />
          <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          {isDragActive ? (
            <p className="text-lg font-medium">Drop the files here...</p>
          ) : (
            <>
              <p className="text-lg font-medium mb-2">
                Drag & drop files here, or click to select
              </p>
              <p className="text-sm text-muted-foreground">
                Accepted formats: {acceptedFormats.join(', ')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Maximum file size: 5GB
              </p>
            </>
          )}
        </div>

        {selectedFiles.length > 0 && (
          <div className="mt-6 space-y-3">
            <h3 className="font-medium">Selected Files:</h3>
            {selectedFiles.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 bg-muted rounded-lg"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <File className="w-5 h-5 text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{file.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFile(index)}
                  disabled={uploadMutation.isPending}
                >
                  Remove
                </Button>
              </div>
            ))}

            <Button
              onClick={handleUpload}
              disabled={uploadMutation.isPending}
              className="w-full"
              size="lg"
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-5 w-5" />
                  Upload {selectedFiles.length} File{selectedFiles.length > 1 ? 's' : ''}
                </>
              )}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
