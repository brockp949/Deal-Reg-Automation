import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
    LayoutDashboard,
    FileText,
    Upload,
    Users,
    CheckCircle2,
    Activity,
    Settings,
    AlertCircle,
    CircuitBoard
} from 'lucide-react';

interface NavItem {
    icon: typeof LayoutDashboard;
    label: string;
    path: string;
}

interface NavGroup {
    title: string;
    items: NavItem[];
}

const navGroups: NavGroup[] = [
    {
        title: 'Main',
        items: [
            { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
            { icon: CircuitBoard, label: 'Deal Studio', path: '/deal-studio' },
            { icon: FileText, label: 'Deals', path: '/deals' },
            { icon: Users, label: 'Vendors', path: '/vendors' },
        ]
    },
    {
        title: 'Operations',
        items: [
            { icon: CheckCircle2, label: 'Approvals', path: '/vendor-approval' },
            { icon: Upload, label: 'Upload', path: '/upload' },
            { icon: Activity, label: 'Monitoring', path: '/monitoring' },
        ]
    },
    {
        title: 'Support',
        items: [
            { icon: AlertCircle, label: 'Errors', path: '/errors' },
        ]
    }
];

interface SidebarProps {
    isOpen?: boolean;
    onClose?: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
    const location = useLocation();

    return (
        <>
            {/* Mobile Overlay */}
            <div
                className={cn(
                    "fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden transition-opacity duration-200",
                    isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
                onClick={onClose}
            />

            {/* Sidebar */}
            <aside
                className={cn(
                    "flex flex-col w-64 min-h-screen border-r border-border bg-background/80 backdrop-blur-xl fixed left-0 top-0 z-50 transition-transform duration-300 md:translate-x-0",
                    isOpen ? "translate-x-0" : "-translate-x-full"
                )}
            >
                <div className="p-6">
                    <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/20 shadow-lg shadow-primary/10">
                                <div className="h-4 w-4 rounded-sm bg-primary" />
                            </div>
                            <span className="font-bold text-lg tracking-tight">DealFlow</span>
                        </div>
                        {/* Mobile Close Button */}
                        <button
                            onClick={onClose}
                            className="md:hidden p-1 hover:bg-muted/50 rounded-md"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                        </button>
                    </div>

                    {/* Grouped Navigation */}
                    <div className="space-y-6">
                        {navGroups.map((group) => (
                            <div key={group.title}>
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2 px-3">
                                    {group.title}
                                </p>
                                <div className="space-y-1">
                                    {group.items.map((item) => {
                                        const Icon = item.icon;
                                        const isActive = location.pathname === item.path;

                                        return (
                                            <Link
                                                key={item.path}
                                                to={item.path}
                                                onClick={() => onClose?.()}
                                                className={cn(
                                                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group relative",
                                                    isActive
                                                        ? "bg-primary/10 text-primary shadow-[0_0_20px_hsl(var(--primary)/0.15)]"
                                                        : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                                                )}
                                            >
                                                {isActive && (
                                                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-primary rounded-full" />
                                                )}
                                                <Icon className={cn(
                                                    "w-4 h-4 transition-colors",
                                                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                                                )} />
                                                {item.label}
                                            </Link>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mt-auto p-6 border-t border-border">
                    <Link
                        to="/settings/sync"
                        onClick={() => onClose?.()}
                        className={cn(
                            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 text-muted-foreground hover:text-foreground hover:bg-muted/30 relative",
                            location.pathname === '/settings/sync' && "bg-primary/10 text-primary"
                        )}
                    >
                        {location.pathname === '/settings/sync' && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-primary rounded-full" />
                        )}
                        <Settings className="w-4 h-4" />
                        Sync Settings
                    </Link>
                </div>
            </aside>
        </>
    );
}
