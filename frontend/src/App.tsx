import { Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Deals from './pages/Deals';
import Vendors from './pages/Vendors';
import VendorDetail from './pages/VendorDetail';
import FileUpload from './pages/FileUpload';
import Layout from './components/Layout';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/deals" element={<Deals />} />
        <Route path="/vendors" element={<Vendors />} />
        <Route path="/vendors/:id" element={<VendorDetail />} />
        <Route path="/upload" element={<FileUpload />} />
      </Routes>
    </Layout>
  );
}

export default App;
