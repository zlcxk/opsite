import { NavLink, Link } from 'react-router-dom';
import {
  Activity,
  Boxes,
  ChevronRight,
  Compass,
  GitBranch,
  LayoutDashboard,
  NotebookPen,
  Radar,
  Settings,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useAppData } from '../contexts/AppDataContext';
import { relativeTime } from '../lib/format';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const mainNav = [
  { to: '/', label: '首页', icon: LayoutDashboard, end: true },
  { to: '/software', label: '软件情报', icon: Boxes, count: 'software' as const },
  { to: '/vulnerabilities', label: '漏洞与修复', icon: ShieldAlert, count: 'pending' as const },
  { to: '/versions', label: '版本与生命周期', icon: GitBranch },
  { to: '/events', label: '情报事件', icon: Activity, count: 'events' as const },
];

const exploreNav = [
  { to: '/radar', label: '技术雷达', icon: Radar },
  { to: '/discover', label: '技术发现', icon: Compass },
  { to: '/knowledge', label: '我的知识库', icon: NotebookPen },
];

function BrandMark() {
  return (
    <svg width="25" height="25" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <circle cx="14" cy="14" r="10.5" stroke="#8fa397" strokeOpacity=".34" />
      <circle cx="14" cy="14" r="6" stroke="#b9c8be" strokeOpacity=".2" />
      <path d="M4.6 17.4a10.5 10.5 0 0 1 17.9-8.9" stroke="#e96538" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="14" cy="14" r="2.1" fill="#e96538" />
      <path d="M14 2.6v3M25.4 14h-3M14 25.4v-3M2.6 14h3" stroke="#c9d5cc" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { data } = useAppData();
  const unread = data?.briefing.unread ?? 0;
  const softwareCount = data?.software.length ?? 0;
  const pending = data?.briefing.pending ?? 0;
  const openAdvisories = data?.briefing.openAdvisories ?? 0;
  const hasIssue = (data?.briefing.sourceIssues ?? 0) > 0;

  const countFor = (key?: 'software' | 'pending' | 'events') => {
    if (key === 'software') return softwareCount;
    if (key === 'pending') return openAdvisories;
    if (key === 'events') return unread;
    return null;
  };

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="主导航">
      <div className="sidebar-brand">
        <span className="brand-mark">
          <BrandMark />
        </span>
        <div>
          <div className="brand-name">OPSITE</div>
          <div className="brand-sub">个人运维情报台</div>
        </div>
        <button className="close-btn sidebar-close" onClick={onClose} aria-label="关闭导航">
          <X size={17} />
        </button>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-group">
          <div className="nav-group-label">工作台 / Desk</div>
          {mainNav.map((item) => {
            const Icon = item.icon;
            const count = countFor(item.count);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                onClick={onClose}
              >
                <Icon size={16} strokeWidth={1.8} />
                <span>{item.label}</span>
                {count !== null && count > 0 && (
                  <span className={`nav-count ${item.count === 'pending' && count > 0 ? 'alert' : ''}`}>{count}</span>
                )}
              </NavLink>
            );
          })}
        </div>

        <div className="nav-group">
          <div className="nav-group-label">探索 / Explore</div>
          {exploreNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                onClick={onClose}
              >
                <Icon size={16} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.to === '/radar' && (data?.radarCount ?? 0) > 0 && (
                  <span className="nav-count">{data?.radarCount}</span>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>

      <div className="sidebar-foot">
        <div className="watch-status">
          <div className="watch-status-head">
            <span className={`live-dot ${hasIssue ? 'warn' : ''}`} />
            {hasIssue ? '采集器有异常' : '采集器运行中'}
            <span className="ml-auto" style={{ fontSize: 8, color: '#5f7266' }}>
              {unread > 0 ? `${unread} 条未读` : '已读'}
            </span>
          </div>
          <div className="watch-status-main">
            监控 {softwareCount} 个软件 · {pending} 项待处理
          </div>
          <div className="watch-status-sub">
            上次同步 {relativeTime(data?.lastSyncAt)}
            {data?.nextSyncAt ? ` · 下次 ${new Date(data.nextSyncAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </div>
        </div>
        <Link to="/settings" className="sidebar-foot-link" onClick={onClose}>
          <span className="inline-flex items-center gap-2">
            <Settings size={14} /> 设置与数据源
          </span>
          <ChevronRight size={13} />
        </Link>
      </div>
    </aside>
  );
}
