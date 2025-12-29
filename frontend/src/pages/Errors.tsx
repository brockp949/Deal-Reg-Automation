import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, Info, XCircle, CheckCircle, RefreshCw, Filter } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { errorAPI } from '@/lib/api';
import { toast } from 'sonner';

interface ErrorLog {
    id: string;
    errorCategory: string;
    errorType: string;
    errorSeverity: string;
    errorMessage: string;
    sourceComponent?: string;
    fileName?: string;
    lineNumber?: number;
    isResolved: boolean;
    resolvedAt?: string;
    resolvedBy?: string;
    resolutionNotes?: string;
    occurredAt: string;
    createdAt: string;
}

export default function Errors() {
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [severityFilter, setSeverityFilter] = useState<string>('all');
    const queryClient = useQueryClient();

    const { data: errorsData, isLoading, refetch } = useQuery({
        queryKey: ['errors', categoryFilter, severityFilter],
        queryFn: async () => {
            const params: any = { limit: 50, unresolved_only: true };
            if (categoryFilter !== 'all') params.category = categoryFilter;
            if (severityFilter !== 'all') params.severity = severityFilter;
            const response = await errorAPI.getAll(params);
            return response.data;
        },
    });

    const resolveMutation = useMutation({
        mutationFn: async (errorId: string) => {
            return await errorAPI.resolve(errorId, { resolved_by: 'UI User' });
        },
        onSuccess: () => {
            toast.success('Error marked as resolved');
            queryClient.invalidateQueries({ queryKey: ['errors'] });
        },
        onError: () => {
            toast.error('Failed to resolve error');
        },
    });

    const errors: ErrorLog[] = errorsData?.success ? errorsData.data.data : [];

    const getSeverityIcon = (severity: string) => {
        switch (severity) {
            case 'critical':
                return <XCircle className="h-5 w-5 text-red-600" />;
            case 'error':
                return <AlertCircle className="h-5 w-5 text-red-500" />;
            case 'warning':
                return <AlertTriangle className="h-5 w-5 text-amber-500" />;
            default:
                return <Info className="h-5 w-5 text-blue-500" />;
        }
    };

    const getSeverityBadge = (severity: string) => {
        switch (severity) {
            case 'critical':
                return <Badge variant="destructive">Critical</Badge>;
            case 'error':
                return <Badge variant="destructive">Error</Badge>;
            case 'warning':
                return <Badge variant="outline">Warning</Badge>;
            default:
                return <Badge variant="secondary">Info</Badge>;
        }
    };

    const getCategoryBadge = (category: string) => {
        const colors: Record<string, string> = {
            parsing: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
            extraction: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
            validation: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
            processing: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
            integration: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
        };
        return (
            <Badge className={colors[category] || 'bg-gray-100 text-gray-800'}>
                {category}
            </Badge>
        );
    };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Error Tracking</h1>
                    <p className="text-muted-foreground mt-1">
                        Monitor and resolve system errors
                    </p>
                </div>
                <Button variant="outline" onClick={() => refetch()} className="glass hover:bg-white/10 gap-2">
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                </Button>
            </div>

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card className="glass-card">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Errors</CardTitle>
                        <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{errors.length}</div>
                        <p className="text-xs text-muted-foreground mt-1">All tracked errors</p>
                    </CardContent>
                </Card>
                <Card className="glass-card">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Unresolved</CardTitle>
                        <XCircle className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-500">
                            {errors.filter(e => !e.isResolved).length}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Needs attention</p>
                    </CardContent>
                </Card>
                <Card className="glass-card">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Resolved</CardTitle>
                        <CheckCircle className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-500">
                            {errors.filter(e => e.isResolved).length}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Successfully handled</p>
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <Card className="glass-panel">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Filter className="h-5 w-5" />
                        Filters
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4 md:grid-cols-2">
                        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                            <SelectTrigger>
                                <SelectValue placeholder="Category" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Categories</SelectItem>
                                <SelectItem value="parsing">Parsing</SelectItem>
                                <SelectItem value="extraction">Extraction</SelectItem>
                                <SelectItem value="validation">Validation</SelectItem>
                                <SelectItem value="processing">Processing</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={severityFilter} onValueChange={setSeverityFilter}>
                            <SelectTrigger>
                                <SelectValue placeholder="Severity" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Severities</SelectItem>
                                <SelectItem value="critical">Critical</SelectItem>
                                <SelectItem value="error">Error</SelectItem>
                                <SelectItem value="warning">Warning</SelectItem>
                                <SelectItem value="info">Info</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {/* Error List */}
            <Card className="glass-panel">
                <CardHeader>
                    <CardTitle>Errors ({errors.length})</CardTitle>
                    <CardDescription>Click resolve to mark an error as handled</CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="text-center py-8 text-muted-foreground">Loading errors...</div>
                    ) : errors.length === 0 ? (
                        <div className="text-center py-8">
                            <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
                            <p className="text-muted-foreground">No errors found</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {errors.map((error) => (
                                <div
                                    key={error.id}
                                    className={`p-4 rounded-lg border border-white/10 transition-colors ${error.isResolved ? 'bg-white/5 opacity-60' : 'hover:bg-white/5'
                                        }`}
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex items-start gap-3 flex-1">
                                            {getSeverityIcon(error.errorSeverity)}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                                    {getSeverityBadge(error.errorSeverity)}
                                                    {getCategoryBadge(error.errorCategory)}
                                                    <span className="text-xs text-muted-foreground">
                                                        {error.errorType}
                                                    </span>
                                                </div>
                                                <p className="font-medium">{error.errorMessage}</p>
                                                <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
                                                    {error.sourceComponent && (
                                                        <span>Component: {error.sourceComponent}</span>
                                                    )}
                                                    {error.fileName && <span>File: {error.fileName}</span>}
                                                    {error.lineNumber && <span>Line: {error.lineNumber}</span>}
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    {new Date(error.occurredAt).toLocaleString()}
                                                </p>
                                                {error.isResolved && (
                                                    <p className="text-xs text-green-600 mt-1">
                                                        Resolved by {error.resolvedBy} on {new Date(error.resolvedAt!).toLocaleString()}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        {!error.isResolved && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => resolveMutation.mutate(error.id)}
                                                disabled={resolveMutation.isPending}
                                            >
                                                <CheckCircle className="h-4 w-4 mr-1" />
                                                Resolve
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
