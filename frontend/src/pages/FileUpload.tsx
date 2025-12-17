import { useState } from 'react';
import { Upload, Cloud } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import UploadWizard from '@/components/upload/UploadWizard';
import SyncOverviewPanel from '@/components/sync/SyncOverviewPanel';
import ClearDataDialog from '@/components/ClearDataDialog';

export default function FileUpload() {
  const [activeTab, setActiveTab] = useState('upload');

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Import Deal Data</h1>
          <p className="text-muted-foreground">
            Upload files manually or sync from Google services
          </p>
        </div>
        <ClearDataDialog />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2 mb-6">
          <TabsTrigger value="upload" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Manual Upload
          </TabsTrigger>
          <TabsTrigger value="sync" className="flex items-center gap-2">
            <Cloud className="h-4 w-4" />
            Google Sync
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-0">
          <UploadWizard />
        </TabsContent>

        <TabsContent value="sync" className="mt-0">
          <SyncOverviewPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
