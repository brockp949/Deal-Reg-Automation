import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileUp, LayoutTemplate } from 'lucide-react';
import UnifiedImportWizard from '@/components/upload/UnifiedImportWizard';
import { DealReviewSplitView } from '@/components/DealReviewSplitView';

export default function DealStudio() {
    const [activeTab, setActiveTab] = useState('upload');
    const [processedDeals, setProcessedDeals] = useState<any[]>([]);

    const handleUploadComplete = async (fileId: string) => {
        try {
            const response = await api.get('/deals', {
                params: { source_file_id: fileId }
            });
            if (response.data.success) {
                const deals = response.data.data;
                setProcessedDeals(deals);

                if (deals.length > 0) {
                    toast.success(`Loaded ${deals.length} deals for review`);
                    setActiveTab('review');
                } else {
                    toast.info('No deals found in the uploaded file');
                }
            }
        } catch (error) {
            console.error('Failed to fetch deals', error);
            toast.error('Failed to load extracted deals');
        }
    };

    return (
        <div className="container py-8 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">Deal Studio</h1>
                    <p className="text-muted-foreground mt-1">
                        AI-powered deal extraction and review workspace
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setActiveTab('upload')}>
                        <FileUp className="mr-2 h-4 w-4" />
                        Upload New
                    </Button>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList className="grid w-full grid-cols-2 lg:w-[400px]">
                    <TabsTrigger value="upload" className="gap-2">
                        <FileUp className="h-4 w-4" />
                        Upload & Process
                    </TabsTrigger>
                    <TabsTrigger value="review" className="gap-2" disabled={processedDeals.length === 0}>
                        <LayoutTemplate className="h-4 w-4" />
                        Review & Approve
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="upload" className="space-y-4">
                    <UnifiedImportWizard onUploadComplete={handleUploadComplete} />
                </TabsContent>

                <TabsContent value="review" className="space-y-4">
                    <DealReviewSplitView
                        deals={processedDeals}
                        onApprove={(deal: any) => console.log('Approved', deal)}
                        onReject={(deal: any) => console.log('Rejected', deal)}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}
