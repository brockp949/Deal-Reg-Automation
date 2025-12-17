import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ThemeToggle } from './ThemeToggle';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();

  const navItems = [
    { path: '/', label: 'Dashboard' },
    { path: '/deals', label: 'Deals' },
    { path: '/vendors', label: 'Vendors' },
    { path: '/vendor-approval', label: 'Vendor Approval' },
    { path: '/upload', label: 'Upload Files' },
    { path: '/settings/sync', label: 'Sync Settings' },
    { path: '/errors', label: 'Errors' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b">
        <div className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-8">
              <Link to="/" className="text-xl font-bold text-primary">
                Deal Reg Automation
              </Link>
              <div className="flex gap-4">
                {navItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      'px-3 py-2 text-sm font-medium rounded-md transition-colors',
                      location.pathname === item.path
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-8">{children}</main>

      <footer className="border-t mt-12">
        <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          Deal Registration Automation System © {new Date().getFullYear()}
        </div>
      </footer>
    </div>
  );
}
