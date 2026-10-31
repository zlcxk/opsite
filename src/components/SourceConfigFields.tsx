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
      <>
        <div className="field-row">
          <label className="field">
            <span className="field-label">NVD 关键词</span>
            <input
              className="field-input"
              value={config.keyword ?? ''}
              onChange={(event) => update('keyword', event.target.value)}
              placeholder="如 PostgreSQL"
            />
          </label>
          <label className="field">
            <span className="field-label">CPE Name（可选，优先）</span>
            <input
              className="field-input"
              value={config.cpeName ?? ''}
              onChange={(event) => update('cpeName', event.target.value)}
              placeholder="cpe:2.3:a:vendor:product:*:*:*:*:*:*:*:*"
            />
          </label>
        </div>
        <label className="field mt-[13px]">
          <span className="field-label">匹配说明（可选）</span>
          <input
            className="field-input"
            value={config.note ?? ''}
            onChange={(event) => update('note', event.target.value)}
            placeholder="如 PostgreSQL 核心与 contrib，不含第三方扩展"
          />
        </label>
        <span className="field-hint mt-2 block">
          同时填写时按 CPE 与关键词联合查询；仅 CPE 时按精确产品匹配，可信度更高。关键词结果需人工核实边界。
        </span>
      </>
    );
  }

  if (type === 'cisa_kev') {
    return (
      <div className="form-note">
        CISA KEV 是已知遭实际利用漏洞的全局目录，仅对本地已采集的 CVE 进行交叉标记，无需额外配置。
        有 KEV 来源不代表已经完整采集该软件的全部安全公告。
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
      if (config.cpeName) return `CPE · ${config.cpeName}${config.keyword ? ` + keyword · ${config.keyword}` : ''}`;
      return config.keyword ? `keyword · ${config.keyword}` : '未配置关键词或 CPE';
    case 'cisa_kev':
      return '全量目录交叉标记';
    default:
      return config.url ?? '未配置';
  }
}
