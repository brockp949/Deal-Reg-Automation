import { useState } from 'react';
import { Upload, Cloud } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import UnifiedImportWizard from '@/components/upload/UnifiedImportWizard';
import SyncOverviewPanel from '@/components/sync/SyncOverviewPanel';
import ClearDataDialog from '@/components/ClearDataDialog';

export default function FileUpload() {
  const [activeTab, setActiveTab] = useState('upload');

  return (
    <div>
      {activeTab === 'sync' && (
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Google Sync</h1>
            <p className="text-muted-foreground">
              Sync deal data from Gmail and Google Drive
            </p>
          </div>
          <ClearDataDialog />
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="flex items-center justify-between mb-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="upload" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              File Import
            </TabsTrigger>
            <TabsTrigger value="sync" className="flex items-center gap-2">
              <Cloud className="h-4 w-4" />
              Google Sync
            </TabsTrigger>
          </TabsList>
          {activeTab === 'upload' && <ClearDataDialog />}
        </div>

        <TabsContent value="upload" className="mt-0">
          <UnifiedImportWizard />
        </TabsContent>

        <TabsContent value="sync" className="mt-0">
          <SyncOverviewPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
