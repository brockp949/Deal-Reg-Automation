import { useState, useCallback } from 'react';
import { api, emailThreadsAPI } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileUp, LayoutTemplate } from 'lucide-react';
import UnifiedImportWizard from '@/components/upload/UnifiedImportWizard';
import { DealReviewSplitView, type Deal } from '@/components/DealReviewSplitView';
import type { EmailThread } from '@/components/EmailThreadViewer';

export default function DealStudio() {
    const [activeTab, setActiveTab] = useState('upload');
    const [processedDeals, setProcessedDeals] = useState<Deal[]>([]);

    const handleUploadComplete = async (fileId: string) => {
        try {
            const response = await api.get('/deals', {
                params: { source_file_id: fileId }
            });
            if (response.data.success) {
                let deals: Deal[] = response.data.data;

                // Try to fetch email thread data for MBOX files
                try {
                    const threadsResponse = await emailThreadsAPI.getByFileId(fileId);
                    if (threadsResponse.data.success && threadsResponse.data.data.threads.length > 0) {
                        const threads: EmailThread[] = threadsResponse.data.data.threads;
                        // Attach threads to all deals from this file
                        deals = deals.map((deal) => ({
                            ...deal,
                            email_threads: threads,
                        }));
                        toast.success(`Loaded ${deals.length} deals with ${threads.length} email threads`);
                    }
                } catch {
                    // Silently ignore - thread data not available for non-MBOX files
                }

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


    const handleApprove = useCallback(async (deal: Deal) => {
        if (!deal.id) {
            toast.error('Deal ID is missing');
            return;
        }
        try {
            await api.patch(`/deals/${deal.id}/status`, { status: 'registered' });
            toast.success(`"${deal.deal_name || 'Deal'}" registered successfully`);
            // Remove from review queue
            setProcessedDeals((prev) => prev.filter((d) => d.id !== deal.id));
        } catch (error) {
            console.error('Failed to register deal', error);
            toast.error('Failed to register deal');
        }
    }, []);

    const handleReject = useCallback(async (deal: Deal) => {
        if (!deal.id) {
            toast.error('Deal ID is missing');
            return;
        }
        try {
            await api.delete(`/deals/${deal.id}`);
            toast.info(`"${deal.deal_name || 'Deal'}" rejected and learning recorded`);
            // Remove from review queue
            setProcessedDeals((prev) => prev.filter((d) => d.id !== deal.id));
        } catch (error) {
            console.error('Failed to reject deal', error);
            toast.error('Failed to reject deal');
        }
    }, []);

    const handleUpdate = useCallback(async (deal: Deal) => {
        if (!deal.id) {
            toast.error('Deal ID is missing');
            return;
        }
        try {
            // Extract only the fields we want to send to the API
            const updatePayload = {
                deal_name: deal.deal_name,
                customer_name: deal.customer_name,
                deal_value: deal.deal_value,
                expected_close_date: deal.expected_close_date,
                description: deal.description,
                notes: deal.notes,
                status: deal.status,
            };
            await api.put(`/deals/${deal.id}`, updatePayload);
            toast.success('Deal updated and learning recorded');
            // Update local state
            setProcessedDeals((prev) =>
                prev.map((d) => (d.id === deal.id ? deal : d))
            );
        } catch (error) {
            console.error('Failed to update deal', error);
            toast.error('Failed to update deal');
        }
    }, []);

    return (
        <div className="h-[calc(100vh-8rem)] flex flex-col space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 animate-slide-up">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary via-purple-400 to-blue-600 bg-clip-text text-transparent">
                        Deal Studio
                    </h1>
                    <p className="text-muted-foreground mt-1 text-sm md:text-base">
                        AI-powered deal extraction and review workspace
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        onClick={() => setActiveTab('upload')}
                        className="glass hover:bg-white/10 border-white/10 transition-all font-medium"
                    >
                        <FileUp className="mr-2 h-4 w-4" />
                        Upload New
                    </Button>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col space-y-4">
                <div className="flex items-center justify-between p-1 bg-muted/50 rounded-lg backdrop-blur-sm border border-white/5 w-fit">
                    <TabsList className="bg-transparent border-0 p-0 h-auto gap-1">
                        <TabsTrigger
                            value="upload"
                            className="gap-2 px-4 py-2 rounded-md data-[state=active]:bg-background/80 data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all duration-300"
                        >
                            <FileUp className="h-4 w-4" />
                            Upload & Process
                        </TabsTrigger>
                        <TabsTrigger
                            value="review"
                            className="gap-2 px-4 py-2 rounded-md data-[state=active]:bg-background/80 data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all duration-300"
                            disabled={processedDeals.length === 0}
                        >
                            <LayoutTemplate className="h-4 w-4" />
                            Review & Approve
                        </TabsTrigger>
                    </TabsList>
                </div>

                <div className="flex-1 overflow-hidden relative rounded-xl border border-white/10 bg-black/20 backdrop-blur-sm shadow-2xl">
                    <TabsContent value="upload" className="h-full p-6 m-0 animate-fade-in focus-visible:outline-none">
                        <div className="max-w-2xl mx-auto mt-8 p-8 glass-card rounded-xl">
                            <UnifiedImportWizard onUploadComplete={handleUploadComplete} />
                        </div>
                    </TabsContent>

                    <TabsContent value="review" className="h-full m-0 animate-fade-in focus-visible:outline-none overflow-hidden">
                        <DealReviewSplitView
                            deals={processedDeals}
                            onApprove={handleApprove}
                            onReject={handleReject}
                            onUpdate={handleUpdate}
                        />
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
}
