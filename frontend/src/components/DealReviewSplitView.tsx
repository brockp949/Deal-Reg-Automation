import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { FileText, Check, X, AlertTriangle, Eye, ChevronRight, ChevronLeft } from 'lucide-react';

interface Deal {
    deal_name?: string;
    customer_name?: string;
    vendor_name?: string;
    deal_value?: number;
    expected_close_date?: string;
    description?: string;
    confidence_score: number;
    source_file?: string;
    raw_text?: string;
    [key: string]: any;
}

interface DealReviewSplitViewProps {
    deals?: Deal[];
    onApprove?: (deal: Deal) => void;
    onReject?: (deal: Deal) => void;
}

export function DealReviewSplitView({ deals = [], onApprove, onReject }: DealReviewSplitViewProps) {
    const [selectedDealIndex, setSelectedDealIndex] = useState(0);
    const [showDocument, setShowDocument] = useState(true);

    const selectedDeal = deals[selectedDealIndex];

    // Handlers
    const handleApprove = () => onApprove?.(selectedDeal);
    const handleReject = () => onReject?.(selectedDeal);

    if (!selectedDeal) {
        return (
            <div className="flex items-center justify-center h-[600px] border-2 border-dashed rounded-lg">
                <div className="text-center text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <h3 className="text-lg font-medium">No deals to review</h3>
                    <p>Upload files to start extracting deals.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-12 gap-6 h-[800px]">
            {/* File List / Navigation */}
            <div className="col-span-12 lg:col-span-3 xl:col-span-2 flex flex-col gap-2 border-r pr-4">
                <h3 className="font-semibold mb-2">Deals Queue ({deals.length})</h3>
                <ScrollArea className="flex-1">
                    <div className="space-y-2">
                        {deals.map((deal, index) => (
                            <div
                                key={index}
                                onClick={() => setSelectedDealIndex(index)}
                                className={`p-3 rounded-lg border cursor-pointer transition-colors ${index === selectedDealIndex
                                    ? 'bg-primary/10 border-primary'
                                    : 'hover:bg-muted'
                                    }`}
                            >
                                <div className="font-medium text-sm truncate">{deal.deal_name || 'Untitled Deal'}</div>
                                <div className="text-xs text-muted-foreground truncate">{deal.customer_name || 'Unknown Customer'}</div>
                                <div className="flex items-center gap-2 mt-2">
                                    <Badge variant={deal.confidence_score > 0.8 ? 'default' : 'secondary'} className="text-[10px] h-5">
                                        {(deal.confidence_score * 100).toFixed(0)}% Conf.
                                    </Badge>
                                </div>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            </div>

            {/* Main Content Area */}
            <div className="col-span-12 lg:col-span-9 xl:col-span-10 grid grid-cols-2 gap-6">

                {/* Document Viewer (Left Pane) */}
                {showDocument && (
                    <Card className="h-full flex flex-col col-span-1 border-muted">
                        <CardHeader className="py-3 px-4 border-b flex flex-row items-center justify-between">
                            <CardTitle className="text-sm font-medium flex items-center gap-2">
                                <FileText className="h-4 w-4" />
                                {selectedDeal.source_file || 'Document Preview'}
                            </CardTitle>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                                <Eye className="h-4 w-4" />
                            </Button>
                        </CardHeader>
                        <CardContent className="flex-1 p-0 overflow-hidden bg-muted/10 relative">
                            {/* Placeholder for actual document rendering */}
                            <div className="absolute inset-0 p-8 overflow-auto font-mono text-sm whitespace-pre-wrap">
                                {selectedDeal.raw_text || "Document content not available for preview."}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Extraction Form (Right Pane) - Expands if doc hidden */}
                <Card className={`h-full flex flex-col ${showDocument ? 'col-span-1' : 'col-span-2'}`}>
                    <CardHeader className="py-3 px-4 border-b flex flex-row items-center justify-between">
                        <CardTitle className="text-sm font-medium">Extracted Data</CardTitle>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => setShowDocument(!showDocument)}>
                                {showDocument ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                                {showDocument ? 'Expand Form' : 'Show Doc'}
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="flex-1 overflow-y-auto p-4 space-y-6">

                        {/* Confidence Alert */}
                        {selectedDeal.confidence_score < 0.7 && (
                            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-900 rounded-md p-3 flex gap-3 text-sm text-yellow-800 dark:text-yellow-200">
                                <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                                <div>
                                    <p className="font-medium">Low Confidence Extraction</p>
                                    <p className="opacity-90">Please review the fields carefully. AI was unsure about some values.</p>
                                </div>
                            </div>
                        )}

                        <div className="space-y-4">
                            <div className="grid gap-2">
                                <Label>Deal Name</Label>
                                <Input defaultValue={dealValue(selectedDeal, 'deal_name')} />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label>Customer</Label>
                                    <Input defaultValue={dealValue(selectedDeal, 'customer_name')} />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Vendor</Label>
                                    <Input defaultValue={dealValue(selectedDeal, 'vendor_name')} />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label>Value</Label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                                        <Input className="pl-6" defaultValue={dealValue(selectedDeal, 'deal_value')} />
                                    </div>
                                </div>
                                <div className="grid gap-2">
                                    <Label>Close Date</Label>
                                    <Input type="date" defaultValue={dealValue(selectedDeal, 'expected_close_date')} />
                                </div>
                            </div>

                            <Separator />

                            <div className="grid gap-2">
                                <Label>Description / Notes</Label>
                                <Textarea className="min-h-[100px]" defaultValue={dealValue(selectedDeal, 'description')} />
                            </div>
                        </div>
                    </CardContent>

                    <div className="p-4 border-t bg-muted/10 flex justify-between items-center">
                        <Button variant="outline" className="text-destructive hover:bg-destructive/10" onClick={handleReject}>
                            <X className="mr-2 h-4 w-4" />
                            Reject
                        </Button>
                        <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={handleApprove}>
                            <Check className="mr-2 h-4 w-4" />
                            Approve & Register
                        </Button>
                    </div>
                </Card>

            </div>
        </div>
    );
}

// Helper to safely get value
function dealValue(deal: Deal, key: string) {
    return deal?.[key] || '';
}
