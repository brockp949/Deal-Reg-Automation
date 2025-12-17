/**
 * @deprecated This component is deprecated and will be removed in a future version.
 * Use the UnifiedImportWizard component instead.
 */

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, File, Loader2, Info, AlertCircle } from 'lucide-react';
import { fileAPI } from '@/lib/api';
import { formatFileSize } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';

interface UploadStepProps {
  title: string;
  description: string;
  acceptedFormats: string[];
  helpText?: string;
  onUploadSuccess?: () => void;
}

interface FileWithProgress {
  file: File;
  progress: number;
  error?: string;
}

export default function UploadStep({
  title,
  description,
  acceptedFormats,
  helpText,
  onUploadSuccess,
}: UploadStepProps) {
  const [selectedFiles, setSelectedFiles] = useState<FileWithProgress[]>([]);
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const onUploadProgress = (progressEvent: any) => {
        const progress = Math.round(
          (progressEvent.loaded * 100) / progressEvent.total
        );
        setSelectedFiles((prevFiles) =>
          prevFiles.map((file) =>
            files.some((f) => f.name === file.file.name)
              ? { ...file, progress }
              : file
          )
        );
      };

      if (files.length === 1) {
        return await fileAPI.upload(files[0], onUploadProgress);
      } else {
        return await fileAPI.batchUpload(files, onUploadProgress);
      }
    },
    onSuccess: (response: any) => {
      const message =
        response?.data?.message ||
        `Successfully uploaded ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}`;
      toast.success(message);
      setSelectedFiles([]);
      queryClient.invalidateQueries({ queryKey: ['files'] });
      onUploadSuccess?.();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to upload files');
    },
  });

  // Validate if file extension matches accepted formats
  const validateFileType = useCallback((file: File): string | undefined => {
    const fileName = file.name.toLowerCase();
    const fileExtension = fileName.substring(fileName.lastIndexOf('.'));

    if (!acceptedFormats.includes(fileExtension)) {
      return `Invalid file type. Expected: ${acceptedFormats.join(', ')}`;
    }

    return undefined;
  }, [acceptedFormats]);

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: any[]) => {
    // Handle rejected files from react-dropzone
    if (rejectedFiles.length > 0) {
      rejectedFiles.forEach((rejection) => {
        const fileName = rejection.file.name;
        const error = rejection.errors[0];

        if (error.code === 'file-too-large') {
          toast.error(`${fileName} is too large. Maximum file size is 5GB.`);
        } else if (error.code === 'file-invalid-type') {
          toast.error(`${fileName} has an invalid file type. Expected: ${acceptedFormats.join(', ')}`);
        } else {
          toast.error(`${fileName}: ${error.message}`);
        }
      });
    }

    // Validate accepted files against step requirements
    const validatedFiles: FileWithProgress[] = acceptedFiles.map((file) => {
      const error = validateFileType(file);
      if (error) {
        toast.error(`${file.name}: ${error}`);
      }
      return { file, progress: 0, error };
    });

    // Only add files without errors
    const validFiles = validatedFiles.filter((f) => !f.error);
    if (validFiles.length > 0) {
      setSelectedFiles((prev) => [...prev, ...validFiles]);
    }
  }, [acceptedFormats, validateFileType]);

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
    if (selectedFiles.length === 0) {
      toast.error('Please select files to upload');
      return;
    }

    // Check if any files have errors
    const filesWithErrors = selectedFiles.filter((f) => f.error);
    if (filesWithErrors.length > 0) {
      toast.error('Please remove invalid files before uploading');
      return;
    }

    // Extract the actual File objects
    const files = selectedFiles.map((f) => f.file);
    uploadMutation.mutate(files);
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
            {selectedFiles.map((fileWithProgress, index) => (
              <div
                key={index}
                className={`flex items-center justify-between p-3 rounded-lg ${
                  fileWithProgress.error ? 'bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800' : 'bg-muted'
                }`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {fileWithProgress.error ? (
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                  ) : (
                    <File className="w-5 h-5 text-primary flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{fileWithProgress.file.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatFileSize(fileWithProgress.file.size)}
                    </p>
                    {fileWithProgress.progress > 0 && fileWithProgress.progress < 100 && (
                      <Progress value={fileWithProgress.progress} className="mt-1" />
                    )}
                    {fileWithProgress.error && (
                      <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                        {fileWithProgress.error}
                      </p>
                    )}
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
              disabled={uploadMutation.isPending || selectedFiles.some((f) => f.error)}
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
