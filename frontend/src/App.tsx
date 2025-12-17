import { Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Deals from './pages/Deals';
import Vendors from './pages/Vendors';
import VendorDetail from './pages/VendorDetail';
import VendorApproval from './pages/VendorApproval';
import FileUpload from './pages/FileUpload';
import Monitoring from './pages/Monitoring';
import Errors from './pages/Errors';
import SyncSettingsPage from './pages/SyncSettingsPage';
import Layout from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/deals" element={<Deals />} />
          <Route path="/vendors" element={<Vendors />} />
          <Route path="/vendors/:id" element={<VendorDetail />} />
          <Route path="/vendor-approval" element={<VendorApproval />} />
          <Route path="/upload" element={<FileUpload />} />
          <Route path="/monitoring" element={<Monitoring />} />
          <Route path="/settings/sync" element={<SyncSettingsPage />} />
          <Route path="/errors" element={<Errors />} />
        </Routes>
      </Layout>
    </ErrorBoundary>
  );
}

export default App;
