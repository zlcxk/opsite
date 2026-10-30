import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Layout } from './components/Layout';
import { EmptyState } from './components/ui';
import { ToastProvider } from './contexts/ToastContext';
import { AppDataProvider } from './contexts/AppDataContext';
import { Dashboard } from './pages/Dashboard';
import { SoftwareList } from './pages/SoftwareList';
import { SoftwareDetail } from './pages/SoftwareDetail';
import { Vulnerabilities } from './pages/Vulnerabilities';
import { Versions } from './pages/Versions';
import { Events } from './pages/Events';
import { Notifications } from './pages/Notifications';
import { Follows } from './pages/Follows';
import { Radar } from './pages/Radar';
import { RadarDetail } from './pages/RadarDetail';
import { Discover } from './pages/Discover';
import { DiscoverDetail } from './pages/DiscoverDetail';
import { Knowledge } from './pages/Knowledge';
import { Settings } from './pages/Settings';
import { OperationsOverviewPage } from './pages/OperationsOverview';
import { OperationsSourcesPage } from './pages/OperationsSources';
import { OperationsSourceDetailPage } from './pages/OperationsSourceDetail';
import { OperationsTasksPage } from './pages/OperationsTasks';
import { OperationsTaskDetailPage } from './pages/OperationsTaskDetail';
import { OperationsRunDetailPage } from './pages/OperationsRunDetail';
import { useDocumentTitle } from './lib/hooks';

function NotFound() {
  useDocumentTitle('页面不存在');
  return (
    <div className="page">
      <EmptyState
        icon={Compass}
        title="这里没有情报"
        description="地址可能写错了，或者这个页面还没有对外开放。"
        actions={
          <Link to="/" className="btn btn-primary">
            回到今日值班台
          </Link>
        }
      />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AppDataProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="software" element={<SoftwareList />} />
              <Route path="software/:id" element={<SoftwareDetail />} />
              <Route path="vulnerabilities" element={<Vulnerabilities />} />
              <Route path="versions" element={<Versions />} />
              <Route path="events" element={<Events />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="follows" element={<Follows />} />
              <Route path="radar" element={<Radar />} />
              <Route path="radar/:id" element={<RadarDetail />} />
              <Route path="discover" element={<Discover />} />
              <Route path="discover/:id" element={<DiscoverDetail />} />
              <Route path="knowledge" element={<Knowledge />} />
              <Route path="operations" element={<OperationsOverviewPage />} />
              <Route path="operations/sources" element={<OperationsSourcesPage />} />
              <Route path="operations/sources/:id" element={<OperationsSourceDetailPage />} />
              <Route path="operations/tasks" element={<OperationsTasksPage />} />
              <Route path="operations/tasks/:id" element={<OperationsTaskDetailPage />} />
              <Route path="operations/runs/:id" element={<OperationsRunDetailPage />} />
              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </AppDataProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
