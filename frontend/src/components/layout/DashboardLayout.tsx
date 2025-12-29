import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { ThemeToggle } from '../ThemeToggle';
import { Button } from '@/components/ui/button';

export default function DashboardLayout() {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    return (
        <div className="min-h-screen bg-background font-sans antialiased text-foreground selection:bg-primary/20 glow-ambient">
            {/* Ambient Background Glow */}
            <div
                className="fixed inset-0 pointer-events-none z-0"
                aria-hidden="true"
            >
                {/* Primary gold glow - top center */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-primary/8 rounded-full blur-[120px] opacity-50" />

                {/* Secondary navy glow - top right */}
                <div className="absolute top-0 right-0 w-[500px] h-[400px] bg-blue-900/20 rounded-full blur-[100px] opacity-40" />

                {/* Tertiary gold glow - bottom left */}
                <div className="absolute bottom-0 left-0 w-[400px] h-[300px] bg-primary/5 rounded-full blur-[80px] opacity-30" />
            </div>

            <Sidebar
                isOpen={isMobileMenuOpen}
                onClose={() => setIsMobileMenuOpen(false)}
            />

            <div className="md:pl-64 flex flex-col min-h-screen transition-all duration-300 relative z-10">
                <header className="h-16 border-b border-border sticky top-0 z-40 px-6 flex items-center justify-between glass">
                    <div className="flex items-center gap-4 md:hidden">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsMobileMenuOpen(true)}
                            className="hover:bg-muted/50"
                        >
                            <Menu className="h-5 w-5" />
                        </Button>
                        <span className="font-bold tracking-tight">DealFlow</span>
                    </div>

                    <div className="ml-auto flex items-center gap-4">
                        <ThemeToggle />
                        <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shadow-lg shadow-primary/10 transition-all hover:shadow-primary/20 hover:border-primary/40">
                            <span className="text-xs font-semibold text-primary">JD</span>
                        </div>
                    </div>
                </header>

                <main className="flex-1 p-6 relative overflow-x-hidden">
                    <div className="mx-auto max-w-7xl animate-fade-in">
                        <Outlet />
                    </div>
                </main>

                {/* Footer */}
                <footer className="border-t border-border py-4 px-6 text-center text-sm text-muted-foreground/60">
                    <p>DealFlow - Deal Registration Automation</p>
                </footer>
            </div>
        </div>
    );
}
