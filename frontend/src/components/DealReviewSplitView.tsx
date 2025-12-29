import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { FileText, Check, X, AlertTriangle, Eye, ChevronRight, ChevronLeft, Save, Loader2, Mail } from 'lucide-react';
import { EmailThreadViewer, type EmailThread } from './EmailThreadViewer';

export interface Deal {
    id?: string;
    deal_name?: string;
    customer_name?: string;
    vendor_name?: string;
    deal_value?: number;
    expected_close_date?: string;
    description?: string;
    notes?: string;
    confidence_score: number;
    source_file?: string;
    raw_text?: string;
    email_threads?: EmailThread[];
    metadata?: {
        source_file_id?: string;
        parser?: {
            fileType?: string;
        };
    };
    [key: string]: any;
}

interface DealReviewSplitViewProps {
    deals?: Deal[];
    onApprove?: (deal: Deal) => void;
    onReject?: (deal: Deal) => void;
    onUpdate?: (deal: Deal) => void;
}

export function DealReviewSplitView({ deals = [], onApprove, onReject, onUpdate }: DealReviewSplitViewProps) {
    const [selectedDealIndex, setSelectedDealIndex] = useState(0);
    const [showDocument, setShowDocument] = useState(true);
    const [editedDeal, setEditedDeal] = useState<Deal | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    const selectedDeal = deals[selectedDealIndex];

    // Reset edited deal when selection changes
    useEffect(() => {
        if (selectedDeal) {
            setEditedDeal({ ...selectedDeal });
            setHasChanges(false);
        }
    }, [selectedDealIndex, selectedDeal]);

    // Handlers
    const handleApprove = async () => {
        if (editedDeal) {
            // If there are changes, save first
            if (hasChanges && onUpdate) {
                setIsSaving(true);
                await onUpdate(editedDeal);
                setIsSaving(false);
            }
            onApprove?.(editedDeal);
        }
    };

    const handleReject = () => {
        if (editedDeal) {
            onReject?.(editedDeal);
        }
    };

    const handleSave = async () => {
        if (editedDeal && onUpdate) {
            setIsSaving(true);
            await onUpdate(editedDeal);
            setIsSaving(false);
            setHasChanges(false);
        }
    };

    const handleFieldChange = (field: string, value: string | number) => {
        if (editedDeal) {
            setEditedDeal({ ...editedDeal, [field]: value });
            setHasChanges(true);
        }
    };

    if (!selectedDeal || !editedDeal) {
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
                                key={deal.id || index}
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
                            {/* Show EmailThreadViewer for email sources, fallback to raw text */}
                            {selectedDeal.email_threads && selectedDeal.email_threads.length > 0 ? (
                                <EmailThreadViewer threads={selectedDeal.email_threads} className="h-full" />
                            ) : selectedDeal.metadata?.parser?.fileType === 'mbox' ? (
                                <div className="flex items-center justify-center h-full text-muted-foreground">
                                    <Mail className="h-8 w-8 mr-2 opacity-50" />
                                    <span>Email thread data not available</span>
                                </div>
                            ) : (
                                <div className="absolute inset-0 p-8 overflow-auto font-mono text-sm whitespace-pre-wrap">
                                    {selectedDeal.raw_text || "Document content not available for preview."}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Extraction Form (Right Pane) - Expands if doc hidden */}
                <Card className={`h-full flex flex-col ${showDocument ? 'col-span-1' : 'col-span-2'}`}>
                    <CardHeader className="py-3 px-4 border-b flex flex-row items-center justify-between">
                        <CardTitle className="text-sm font-medium">Extracted Data</CardTitle>
                        <div className="flex items-center gap-2">
                            {hasChanges && (
                                <Badge variant="outline" className="text-amber-600 border-amber-300">
                                    Unsaved Changes
                                </Badge>
                            )}
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
                                <Input
                                    value={editedDeal.deal_name || ''}
                                    onChange={(e) => handleFieldChange('deal_name', e.target.value)}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label>Customer</Label>
                                    <Input
                                        value={editedDeal.customer_name || ''}
                                        onChange={(e) => handleFieldChange('customer_name', e.target.value)}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Vendor</Label>
                                    <Input
                                        value={editedDeal.vendor_name || ''}
                                        disabled
                                        className="bg-muted"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label>Value</Label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                                        <Input
                                            className="pl-6"
                                            type="number"
                                            value={editedDeal.deal_value || ''}
                                            onChange={(e) => handleFieldChange('deal_value', parseFloat(e.target.value) || 0)}
                                        />
                                    </div>
                                </div>
                                <div className="grid gap-2">
                                    <Label>Close Date</Label>
                                    <Input
                                        type="date"
                                        value={editedDeal.expected_close_date?.split('T')[0] || ''}
                                        onChange={(e) => handleFieldChange('expected_close_date', e.target.value)}
                                    />
                                </div>
                            </div>

                            <Separator />

                            <div className="grid gap-2">
                                <Label>Description / Notes</Label>
                                <Textarea
                                    className="min-h-[100px]"
                                    value={editedDeal.notes || editedDeal.description || ''}
                                    onChange={(e) => handleFieldChange('notes', e.target.value)}
                                />
                            </div>
                        </div>
                    </CardContent>

                    <div className="p-4 border-t bg-muted/10 flex justify-between items-center">
                        <Button variant="outline" className="text-destructive hover:bg-destructive/10" onClick={handleReject}>
                            <X className="mr-2 h-4 w-4" />
                            Reject
                        </Button>
                        <div className="flex gap-2">
                            {hasChanges && (
                                <Button variant="outline" onClick={handleSave} disabled={isSaving}>
                                    {isSaving ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        <Save className="mr-2 h-4 w-4" />
                                    )}
                                    Save Changes
                                </Button>
                            )}
                            <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={handleApprove} disabled={isSaving}>
                                {isSaving ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Check className="mr-2 h-4 w-4" />
                                )}
                                Approve & Register
                            </Button>
                        </div>
                    </div>
                </Card>

            </div>
        </div>
    );
}

