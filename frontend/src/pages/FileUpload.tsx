import { useState } from 'react';
import { Upload, Cloud } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import UnifiedImportWizard from '@/components/upload/UnifiedImportWizard';
import SyncOverviewPanel from '@/components/sync/SyncOverviewPanel';
import ClearDataDialog from '@/components/ClearDataDialog';

export default function FileUpload() {
  const [activeTab, setActiveTab] = useState('upload');

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {activeTab === 'upload' ? 'Import Files' : 'Google Sync'}
          </h1>
          <p className="text-muted-foreground mt-1">
            {activeTab === 'upload'
              ? 'Upload vendor lists, deal spreadsheets, email archives, or meeting transcripts'
              : 'Sync deal data from Gmail and Google Drive'}
          </p>
        </div>
        <ClearDataDialog />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2 glass">
          <TabsTrigger value="upload" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            File Import
          </TabsTrigger>
          <TabsTrigger value="sync" className="flex items-center gap-2">
            <Cloud className="h-4 w-4" />
            Google Sync
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-6">
          <UnifiedImportWizard />
        </TabsContent>

        <TabsContent value="sync" className="mt-6">
          <SyncOverviewPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
