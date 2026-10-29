import type { SourceConfig, SourceType } from '@shared/types';

export function SourceConfigFields({
  type,
  config,
  onChange,
}: {
  type: SourceType;
  config: SourceConfig;
  onChange: (config: SourceConfig) => void;
}) {
  const update = (key: keyof SourceConfig, value: string) => onChange({ ...config, [key]: value });

  if (type === 'endoflife') {
    return (
      <div className="field-row">
        <label className="field">
          <span className="field-label">endoflife.date 产品标识</span>
          <input
            className="field-input"
            value={config.product ?? ''}
            onChange={(event) => update('product', event.target.value)}
            placeholder="如 kubernetes"
          />
        </label>
        <span className="field-hint self-end pb-2.5">
          使用与 endoflife.date URL 一致的产品 slug。
        </span>
      </div>
    );
  }

  if (type === 'github_releases') {
    return (
      <label className="field">
        <span className="field-label">GitHub 仓库</span>
        <input
          className="field-input"
          value={config.repo ?? ''}
          onChange={(event) => update('repo', event.target.value)}
          placeholder="owner/repo，如 kubernetes/kubernetes"
        />
      </label>
    );
  }

  if (type === 'github_advisories') {
    return (
      <div className="field-row">
        <label className="field">
          <span className="field-label">软件包名称</span>
          <input
            className="field-input"
            value={config.package ?? ''}
            onChange={(event) => update('package', event.target.value)}
            placeholder="如 openssl"
          />
        </label>
        <label className="field">
          <span className="field-label">生态（可选）</span>
          <input
            className="field-input"
            value={config.ecosystem ?? ''}
            onChange={(event) => update('ecosystem', event.target.value)}
            placeholder="如 npm、Go、PyPI"
          />
        </label>
      </div>
    );
  }

  if (type === 'nvd') {
    return (
      <label className="field">
        <span className="field-label">NVD 关键词</span>
        <input
          className="field-input"
          value={config.keyword ?? ''}
          onChange={(event) => update('keyword', event.target.value)}
          placeholder="如 PostgreSQL"
        />
        <span className="field-hint">关键词越精确，误匹配越少。匹配结果会标记为中等可信度。</span>
      </label>
    );
  }

  if (type === 'cisa_kev') {
    return (
      <div className="form-note">
        CISA KEV 使用全量公共目录，仅对本地已采集的 CVE 进行交叉标记，无需额外配置。
      </div>
    );
  }

  return (
    <label className="field">
      <span className="field-label">公告地址</span>
      <input
        className="field-input"
        value={config.url ?? ''}
        onChange={(event) => update('url', event.target.value)}
        placeholder="https://…"
      />
    </label>
  );
}

export function summarizeConfig(type: SourceType, config: SourceConfig): string {
  switch (type) {
    case 'endoflife':
      return config.product ? `product · ${config.product}` : '未配置产品标识';
    case 'github_releases':
      return config.repo ? `repo · ${config.repo}` : '未配置仓库';
    case 'github_advisories':
      return config.package ? `package · ${config.package}` : '未配置软件包';
    case 'nvd':
      return config.keyword ? `keyword · ${config.keyword}` : '未配置关键词';
    case 'cisa_kev':
      return '全量目录交叉标记';
    default:
      return config.url ?? '未配置';
  }
}
