/**
 * EmailThreadViewer
 *
 * Renders email threads in a rich, inbox-style format with keyword highlighting.
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, Mail, User, Clock, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';

// Keywords that trigger extraction (for highlighting)
const TIER1_KEYWORDS = [
    'deal registration',
    'opportunity registration',
    'deal reg',
    'registration confirmed',
    'signed contract',
    'purchase order',
    'po number',
    'agreement signed',
    'deal closed',
];

const TIER2_KEYWORDS = [
    'new opportunity',
    'qualified lead',
    'request for quote',
    'rfq',
    'pricing protection',
    'proposal submitted',
    'quote submitted',
    'decision maker',
    'budget approved',
    'letter of intent',
    'statement of work',
];

export interface EmailMessage {
    message_id: string;
    from: string;
    to?: string[];
    cc?: string[];
    subject: string;
    date: string | Date;
    cleaned_body: string;
    tier1_matches?: string[];
    tier2_matches?: string[];
    tier3_matches?: string[];
}

export interface EmailThread {
    thread_id: string;
    subject_normalized: string;
    messages: EmailMessage[];
    first_message_date: string | Date;
    last_message_date: string | Date;
    participant_emails: string[];
}

interface EmailThreadViewerProps {
    threads?: EmailThread[];
    className?: string;
}

export function EmailThreadViewer({ threads, className }: EmailThreadViewerProps) {
    const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
    const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());

    if (!threads || threads.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground">
                <Mail className="h-8 w-8 mr-2 opacity-50" />
                <span>No email threads available</span>
            </div>
        );
    }

    const toggleThread = (threadId: string) => {
        setExpandedThreads((prev) => {
            const next = new Set(prev);
            if (next.has(threadId)) {
                next.delete(threadId);
            } else {
                next.add(threadId);
            }
            return next;
        });
    };

    const toggleMessage = (messageId: string) => {
        setExpandedMessages((prev) => {
            const next = new Set(prev);
            if (next.has(messageId)) {
                next.delete(messageId);
            } else {
                next.add(messageId);
            }
            return next;
        });
    };

    const formatDate = (date: string | Date) => {
        const d = typeof date === 'string' ? new Date(date) : date;
        return d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });
    };

    const highlightKeywords = (text: string) => {
        if (!text) return text;

        let result = text;
        const allKeywords = [...TIER1_KEYWORDS, ...TIER2_KEYWORDS];

        // Create a regex pattern for all keywords
        const pattern = new RegExp(
            `(${allKeywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
            'gi'
        );

        // Replace with highlighted version
        result = result.replace(
            pattern,
            '<mark class="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">$1</mark>'
        );

        return result;
    };

    return (
        <ScrollArea className={cn('h-full', className)}>
            <div className="space-y-3 p-4">
                {threads.map((thread) => {
                    const isExpanded = expandedThreads.has(thread.thread_id);
                    const messageCount = thread.messages.length;

                    return (
                        <Card key={thread.thread_id} className="overflow-hidden">
                            <CardHeader
                                className="py-2 px-3 cursor-pointer hover:bg-muted/50 transition-colors"
                                onClick={() => toggleThread(thread.thread_id)}
                            >
                                <div className="flex items-center gap-2">
                                    <Button variant="ghost" size="icon" className="h-5 w-5 p-0">
                                        {isExpanded ? (
                                            <ChevronDown className="h-4 w-4" />
                                        ) : (
                                            <ChevronRight className="h-4 w-4" />
                                        )}
                                    </Button>
                                    <Mail className="h-4 w-4 text-muted-foreground" />
                                    <span className="font-medium text-sm flex-1 truncate">
                                        {thread.subject_normalized || 'No Subject'}
                                    </span>
                                    <Badge variant="secondary" className="text-[10px]">
                                        {messageCount} {messageCount === 1 ? 'email' : 'emails'}
                                    </Badge>
                                </div>
                            </CardHeader>

                            {isExpanded && (
                                <CardContent className="p-0 border-t">
                                    <div className="divide-y">
                                        {thread.messages.map((message) => {
                                            const isMsgExpanded = expandedMessages.has(message.message_id);

                                            return (
                                                <div key={message.message_id} className="bg-background">
                                                    <div
                                                        className="flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-muted/30"
                                                        onClick={() => toggleMessage(message.message_id)}
                                                    >
                                                        <Button variant="ghost" size="icon" className="h-4 w-4 p-0">
                                                            {isMsgExpanded ? (
                                                                <ChevronDown className="h-3 w-3" />
                                                            ) : (
                                                                <ChevronRight className="h-3 w-3" />
                                                            )}
                                                        </Button>
                                                        <User className="h-3 w-3 text-muted-foreground" />
                                                        <span className="text-xs font-medium truncate max-w-[150px]">
                                                            {message.from || 'Unknown'}
                                                        </span>
                                                        <Clock className="h-3 w-3 text-muted-foreground ml-auto" />
                                                        <span className="text-[10px] text-muted-foreground">
                                                            {formatDate(message.date)}
                                                        </span>
                                                        {(message.tier1_matches?.length ?? 0) > 0 && (
                                                            <Badge className="bg-green-100 text-green-800 text-[9px] h-4">
                                                                <Tag className="h-2 w-2 mr-0.5" />
                                                                T1
                                                            </Badge>
                                                        )}
                                                        {(message.tier2_matches?.length ?? 0) > 0 && (
                                                            <Badge className="bg-blue-100 text-blue-800 text-[9px] h-4">
                                                                <Tag className="h-2 w-2 mr-0.5" />
                                                                T2
                                                            </Badge>
                                                        )}
                                                    </div>

                                                    {isMsgExpanded && (
                                                        <div className="px-8 py-3 bg-muted/10 border-t">
                                                            <div className="text-xs text-muted-foreground mb-2">
                                                                <strong>To:</strong> {message.to?.join(', ') || 'N/A'}
                                                                {message.cc && message.cc.length > 0 && (
                                                                    <>
                                                                        {' | '}
                                                                        <strong>CC:</strong> {message.cc.join(', ')}
                                                                    </>
                                                                )}
                                                            </div>
                                                            <div
                                                                className="text-sm whitespace-pre-wrap leading-relaxed"
                                                                dangerouslySetInnerHTML={{
                                                                    __html: highlightKeywords(message.cleaned_body || ''),
                                                                }}
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </CardContent>
                            )}
                        </Card>
                    );
                })}
            </div>
        </ScrollArea>
    );
}
