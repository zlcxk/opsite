import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, CornerDownLeft, Search, ShieldAlert, Tag } from 'lucide-react';
import type { SearchResult } from '@shared/types';
import { useApi, useDebouncedValue } from '../lib/hooks';
import { Logo } from './Logo';

interface SearchPaletteProps {
  open: boolean;
  onClose: () => void;
}

const quickLinks = [
  { label: '情报事件中心', path: '/events', hint: '按首次发现时间查看全部信号' },
  { label: '漏洞与修复中心', path: '/vulnerabilities', hint: '按优先级处理当前风险' },
  { label: '版本与生命周期', path: '/versions', hint: '检查 EOL 与待升级版本' },
  { label: '软件清单设置', path: '/settings', hint: '维护数据源与采集任务' },
];

export function SearchPalette({ open, onClose }: SearchPaletteProps) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 220);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { data, loading } = useApi<SearchResult>(
    open && debounced.trim() ? `/search?q=${encodeURIComponent(debounced.trim())}` : null,
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  const hasResults = Boolean(
    data && (data.software.length || data.events.length || data.advisories.length),
  );

  return (
    <div className="search-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="search-palette" role="dialog" aria-modal="true" aria-label="全局搜索">
        <div className="search-palette-input">
          <Search size={17} className="text-[var(--muted)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索软件、CVE、版本或情报…"
            aria-label="搜索"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="search-results">
          {!debounced.trim() ? (
            <>
              <div className="search-group-label">快速前往</div>
              {quickLinks.map((link) => (
                <button className="search-result" key={link.path} onClick={() => go(link.path)}>
                  <span className="empty-mark" style={{ width: 30, height: 30, margin: 0 }}>
                    <ArrowUpRight size={13} />
                  </span>
                  <span className="search-result-main">
                    <strong>{link.label}</strong>
                    <span>{link.hint}</span>
                  </span>
                  <CornerDownLeft size={13} className="faint" />
                </button>
              ))}
            </>
          ) : loading && !data ? (
            <div className="search-empty">正在检索情报库…</div>
          ) : !hasResults ? (
            <div className="search-empty">
              没有找到与「{debounced.trim()}」相关的记录
            </div>
          ) : (
            <>
              {data && data.software.length > 0 && (
                <>
                  <div className="search-group-label">软件</div>
                  {data.software.map((item) => (
                    <button className="search-result" key={item.id} onClick={() => go(`/software/${item.id}`)}>
                      <Logo name={item.name} logoUrl={null} size="sm" />
                      <span className="search-result-main">
                        <strong>{item.name}</strong>
                        <span>{item.category}</span>
                      </span>
                      <ArrowUpRight size={13} className="faint" />
                    </button>
                  ))}
                </>
              )}
              {data && data.advisories.length > 0 && (
                <>
                  <div className="search-group-label">漏洞</div>
                  {data.advisories.map((item) => (
                    <button
                      className="search-result"
                      key={item.id}
                      onClick={() => go(`/software/${item.softwareId}?tab=vulnerabilities`)}
                    >
                      <span className="empty-mark" style={{ width: 30, height: 30, margin: 0 }}>
                        <ShieldAlert size={13} />
                      </span>
                      <span className="search-result-main">
                        <strong>
                          {item.identifier} · {item.title}
                        </strong>
                        <span>{item.severity} · 安全公告</span>
                      </span>
                      <ArrowUpRight size={13} className="faint" />
                    </button>
                  ))}
                </>
              )}
              {data && data.events.length > 0 && (
                <>
                  <div className="search-group-label">情报事件</div>
                  {data.events.map((event) => (
                    <button
                      className="search-result"
                      key={event.id}
                      onClick={() =>
                        go(
                          `/software/${event.softwareId}?tab=${
                            event.type === 'vulnerability'
                              ? 'vulnerabilities'
                              : event.type === 'release'
                                ? 'releases'
                                : 'lifecycle'
                          }`,
                        )
                      }
                    >
                      <span className="empty-mark" style={{ width: 30, height: 30, margin: 0 }}>
                        <Tag size={13} />
                      </span>
                      <span className="search-result-main">
                        <strong>{event.title}</strong>
                        <span>
                          {event.softwareName} · {event.priority}
                        </span>
                      </span>
                      <ArrowUpRight size={13} className="faint" />
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
