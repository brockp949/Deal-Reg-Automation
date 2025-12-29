import { Routes, Route, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Deals from './pages/Deals';
import Vendors from './pages/Vendors';
import VendorDetail from './pages/VendorDetail';
import VendorApproval from './pages/VendorApproval';
import FileUpload from './pages/FileUpload';
import DealStudio from './pages/DealStudio';
import Monitoring from './pages/Monitoring';
import Errors from './pages/Errors';
import SyncSettingsPage from './pages/SyncSettingsPage';
import DashboardLayout from './components/layout/DashboardLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Button } from './components/ui/button';
import { Home, ArrowLeft } from 'lucide-react';

// 404 Not Found Page
function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-fade-in">
      <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center mb-6">
        <span className="text-5xl font-bold text-primary">404</span>
      </div>
      <h1 className="text-3xl font-bold mb-2">Page Not Found</h1>
      <p className="text-muted-foreground mb-6 max-w-md">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => window.history.back()} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Go Back
        </Button>
        <Button asChild className="gap-2">
          <Link to="/">
            <Home className="h-4 w-4" />
            Dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/deals" element={<Deals />} />
          <Route path="/vendors" element={<Vendors />} />
          <Route path="/vendors/:id" element={<VendorDetail />} />
          <Route path="/vendor-approval" element={<VendorApproval />} />
          <Route path="/upload" element={<FileUpload />} />
          <Route path="/monitoring" element={<Monitoring />} />
          <Route path="/deal-studio" element={<DealStudio />} />
          <Route path="/settings/sync" element={<SyncSettingsPage />} />
          <Route path="/errors" element={<Errors />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}

export default App;
