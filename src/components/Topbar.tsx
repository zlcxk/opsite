import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bell, Menu, Search } from 'lucide-react';
import { useAppData } from '../contexts/AppDataContext';
import { SearchPalette } from './SearchPalette';
import { NotificationDrawer } from './NotificationDrawer';

interface TopbarProps {
  onMenu: () => void;
}

const pageNames: Array<[RegExp, string]> = [
  [/^\/software\/[^/]+$/, '软件详情'],
  [/^\/software$/, '软件情报'],
  [/^\/vulnerabilities$/, '漏洞与修复'],
  [/^\/versions$/, '版本与生命周期'],
  [/^\/events$/, '情报事件'],
  [/^\/notifications$/, '通知中心'],
  [/^\/follows$/, '关注与订阅'],
  [/^\/radar\/[^/]+$/, '雷达条目'],
  [/^\/radar$/, '技术雷达'],
  [/^\/discover\/[^/]+$/, '候选详情'],
  [/^\/discover$/, '技术发现'],
  [/^\/knowledge$/, '我的知识库'],
  [/^\/operations\/sources\/[^/]+$/, '数据源详情'],
  [/^\/operations\/sources$/, '数据源管理'],
  [/^\/operations\/tasks\/[^/]+$/, '采集任务详情'],
  [/^\/operations\/tasks$/, '采集任务'],
  [/^\/operations\/runs\/[^/]+$/, '执行详情'],
  [/^\/operations$/, '运行中心'],
  [/^\/settings$/, '设置'],
  [/^\/$/, '首页'],
];

function nowParts() {
  const date = new Date();
  return {
    time: date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
    date: new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' }).format(date),
  };
}

export function Topbar({ onMenu }: TopbarProps) {
  const location = useLocation();
  const { data } = useAppData();
  const [clock, setClock] = useState(nowParts);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const pageName = pageNames.find(([pattern]) => pattern.test(location.pathname))?.[1] ?? '工作台';
  const unread = data?.notifications.unread ?? 0;

  useEffect(() => {
    const timer = window.setInterval(() => setClock(nowParts()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-btn mobile-menu" onClick={onMenu} aria-label="打开导航">
            <Menu size={18} />
          </button>
          <div className="topbar-crumb">
            <span className="mono text-[0.6875rem] tracking-[0.12em] uppercase">Desk</span>
            <span>/</span>
            <strong>{pageName}</strong>
          </div>
          <button className="search-trigger" onClick={() => setSearchOpen(true)} aria-label="全局搜索">
            <Search size={15} />
            <span>搜索软件、CVE、版本…</span>
            <kbd>Ctrl K</kbd>
          </button>
        </div>
        <div className="topbar-right">
          <div className="topbar-clock" aria-label="当前时间">
            <div className="time">{clock.time}</div>
            <div className="date">{clock.date}</div>
          </div>
          <button
            className="icon-btn"
            onClick={() => setNotificationsOpen(true)}
            aria-label={`通知${unread ? `，${unread} 条未读` : ''}`}
          >
            <Bell size={17} strokeWidth={1.8} />
            {unread > 0 && <span className="badge-dot">{unread > 99 ? '99+' : unread}</span>}
          </button>
        </div>
      </header>
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <NotificationDrawer open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
    </>
  );
}
