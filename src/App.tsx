import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { CycleProvider } from './lib/cycle';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Entities from './pages/Entities';
import EntityDetail from './pages/EntityDetail';
import ImportRoster from './pages/ImportRoster';
import CashInventory from './pages/CashInventory';
import Reconciliation from './pages/Reconciliation';
import History from './pages/History';
import CycleArchive from './pages/CycleArchive';

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="full-screen-center">جارٍ التحميل...</div>;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/entities" element={<Entities />} />
                <Route path="/entities/:entityId" element={<EntityDetail />} />
                <Route path="/import" element={<ImportRoster />} />
                <Route path="/cash" element={<CashInventory />} />
                <Route path="/reconciliation" element={<Reconciliation />} />
                <Route path="/history" element={<History />} />
                <Route path="/archive" element={<CycleArchive />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CycleProvider>
          <AppRoutes />
        </CycleProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
