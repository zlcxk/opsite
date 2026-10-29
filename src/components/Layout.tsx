import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <Sidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />
      {mobileOpen && <div className="mobile-scrim" onClick={() => setMobileOpen(false)} />}
      <div className="app-main">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
