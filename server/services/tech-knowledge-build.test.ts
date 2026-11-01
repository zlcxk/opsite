import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { KnowledgeBuildRequest } from '../../shared/types.js';

let dataDir: string;
let dbModule: typeof import('../db.js');
let tech: typeof import('./tech.js');
let softwareService: typeof import('./software.js');
let seed: typeof import('./tech-seed.js');
let build: typeof import('./tech-knowledge-build.js');
let templates: typeof import('./tech-knowledge-templates.js');
let urlcheck: typeof import('./tech-knowledge-urlcheck.js');

let domainId: string;

const REQUIRED_SECTIONS = [
  '技术定位',
  '设计原理',
  '工作机制',
  '关键配置与实践',
  '版本差异与兼容性',
  '常见问题与限制',
  '技术关联',
  '参考资料',
];

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsite-build-'));
  process.env.DATA_DIR = dataDir;
  dbModule = await import('../db.js');
  tech = await import('./tech.js');
  softwareService = await import('./software.js');
  seed = await import('./tech-seed.js');
  build = await import('./tech-knowledge-build.js');
  templates = await import('./tech-knowledge-templates.js');
  urlcheck = await import('./tech-knowledge-urlcheck.js');
  seed.seedTechnologyTemplates();
  domainId = tech.createDomain({ name: '知识建档测试域', description: '用于 P5.5.1 测试' }).id;
});

afterAll(() => {
  try {
    dbModule?.db.close();
  } catch {
    // ignore
  }
  delete process.env.DATA_DIR;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function createSoftware(name: string, extra: Partial<Parameters<typeof softwareService.createSoftware>[0]> = {}) {
  return softwareService.createSoftware({
    name,
    category: '测试软件',
    website: `https://example.com/${encodeURIComponent(name)}`,
    repo: `https://github.com/example/${encodeURIComponent(name)}`,
    description: `${name} 是用于测试的标准组件。`,
    currentVersion: '1.2.3',
    sources: [],
    ...extra,
  });
}

function preview(request: KnowledgeBuildRequest) {
  return build.previewKnowledgeBuild(request);
}

function execute(request: KnowledgeBuildRequest) {
  const first = preview(request);
  return build.executeKnowledgeBuild({
    ...request,
    confirmed: true,
    previewId: first.previewId,
    previewHash: first.previewHash,
  });
}

describe('standard knowledge templates', () => {
  it('ships five templates with the fixed eight sections and comment prompts', () => {
    expect(templates.KNOWLEDGE_BUILD_TEMPLATES).toHaveLength(5);
    expect(templates.KNOWLEDGE_BUILD_TEMPLATES.map((item) => item.key).sort()).toEqual([
      'component-l2-v1',
      'concept-l2-v1',
      'practice-l2-v1',
      'protocol-l2-v1',
      'resource-l2-v1',
    ]);
    for (const template of templates.KNOWLEDGE_BUILD_TEMPLATES) {
      expect(template.sections.map((section) => section.title)).toEqual(REQUIRED_SECTIONS);
      for (const section of template.sections) {
        expect(section.prompt.length).toBeGreaterThan(10);
        expect(section.prompt).not.toMatch(/^##/);
      }
    }
  });

  it('renders a normalized draft skeleton with prompts that cannot be mistaken for content', () => {
    const template = templates.getKnowledgeBuildTemplate('component-l2-v1')!;
    const markdown = templates.renderKnowledgeDocument(template, {
      name: 'Demo',
      nodeType: 'component',
      description: '已知的软件描述。',
      currentVersion: '9.1.0',
      latestVersion: '9.2.0',
      category: '开发工具',
      docsUrl: 'https://example.com/docs',
      referenceLinks: [
        { label: '发布说明', url: 'https://example.com/releases' },
        { label: '架构', url: 'https://example.com/architecture' },
      ],
    });
    expect([...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1])).toEqual(REQUIRED_SECTIONS);
    expect(markdown).toContain('<!-- 写作提示：');
    expect(markdown).toContain('已录入分类');
    expect(markdown).not.toContain('## 最新版本');
    expect(markdown).toContain('文档适用版本 | 待核实');
  });
});

describe('scope preview and execution', () => {
  it('requires an explicit scope instead of defaulting to the whole catalog', () => {
    expect(() => preview({ scopeType: 'software' })).toThrow(/明确选择/);
    expect(() => preview({ scopeType: 'nodes' })).toThrow(/明确选择/);
  });

  it('reports unlinked software as pending until the target is specified', () => {
    const softwareId = createSoftware('Pending Tool');
    const result = preview({
      scopeType: 'software',
      software: { ids: [softwareId] },
      templateKey: 'component-l2-v1',
      mapping: { linkStrategy: 'none' },
    });
    expect(result.counts.pending).toBe(1);
    expect(result.counts.unlinkedSoftware).toBe(1);
    expect(result.items[0].reason).toContain('关联');
  });

  it('creates a node, links software and initializes a draft without claiming versions', () => {
    const softwareId = createSoftware('Demo Tool');
    const request: KnowledgeBuildRequest = {
      scopeType: 'software',
      software: { ids: [softwareId] },
      templateKey: 'component-l2-v1',
      mapping: {
        domainId,
        linkStrategy: 'create_node',
        nodeType: 'component',
      },
      sources: {
        docsUrl: 'https://example.com/demo/docs',
        referenceLinks: [
          { label: '发布说明', url: 'https://example.com/demo/releases' },
          { label: '架构', url: 'https://example.com/demo/architecture' },
        ],
      },
    };
    const first = preview(request);
    expect(first.counts.createNode).toBe(1);
    expect(first.counts.selectedSoftware).toBe(1);

    const result = execute(request);
    expect(result.counts.created).toBe(1);
    const nodeId = result.items[0].nodeId!;
    const node = tech.getNode(nodeId)!;
    expect(node.name).toBe('Demo Tool');
    expect(node.contentStatus).toBe('draft');
    expect(node.applicableVersions).toBeNull();
    expect(node.contentMarkdown).toContain('## 版本差异与兼容性');
    expect(node.contentMarkdown).toContain('待核实');
    expect([...node.contentMarkdown!.matchAll(/^## (.+)$/gm)].map((match) => match[1])).toEqual(
      REQUIRED_SECTIONS,
    );
    const detail = tech.getNodeDetail(nodeId)!;
    expect(detail.software.map((link) => link.software.id)).toContain(softwareId);

    const again = preview(request);
    expect(again.counts.skip).toBe(1);
    expect(again.counts.initializeDoc).toBe(0);
    const second = execute(request);
    expect(second.counts.skipped).toBe(1);
    expect(tech.getNode(nodeId)!.contentMarkdown).toBe(node.contentMarkdown);
  });

  it('never overwrites an existing Markdown body', () => {
    const node = tech.createNode(domainId, {
      name: 'Existing Body',
      nodeType: 'concept',
      contentMarkdown: 'CUSTOM BODY MUST SURVIVE',
    });
    const request: KnowledgeBuildRequest = {
      scopeType: 'nodes',
      nodes: { ids: [node.id] },
      templateKey: 'concept-l2-v1',
    };
    const first = preview(request);
    expect(first.counts.skip).toBe(1);
    const result = execute(request);
    expect(result.counts.skipped).toBe(1);
    expect(tech.getNode(node.id)!.contentMarkdown).toBe('CUSTOM BODY MUST SURVIVE');
  });

  it('applies onlyDraft and onlyMissing to empty nodes without overwriting anything', () => {
    const draftNode = tech.createNode(domainId, { name: 'Empty Draft', nodeType: 'concept' });
    const missingNode = tech.createNode(domainId, { name: 'Empty Missing', nodeType: 'concept' });
    const draftWithBody = tech.createNode(domainId, {
      name: 'Draft With Body',
      nodeType: 'concept',
      contentMarkdown: 'DRAFT BODY MUST SURVIVE',
    });
    dbModule.db
      .prepare("UPDATE tech_nodes SET content_status = 'draft' WHERE id IN (?, ?)")
      .run(draftNode.id, draftWithBody.id);
    const request: KnowledgeBuildRequest = {
      scopeType: 'nodes',
      nodes: { ids: [draftNode.id, draftWithBody.id] },
      filters: { onlyDraft: true },
      templateKey: 'concept-l2-v1',
    };
    const result = preview(request);
    expect(result.counts.initializeDoc).toBe(1);
    expect(result.counts.skip).toBe(1);
    expect(result.counts.selectedNodes).toBe(2);

    const existing = tech.createNode(domainId, {
      name: 'Body For Missing Filter',
      nodeType: 'concept',
      contentMarkdown: 'KEEP ME',
    });
    const onlyMissing = preview({
      scopeType: 'nodes',
      nodes: { ids: [existing.id, missingNode.id] },
      filters: { onlyMissing: true },
    });
    expect(onlyMissing.counts.initializeDoc).toBe(1);
    expect(onlyMissing.counts.skip).toBe(0);
    expect(onlyMissing.counts.selectedNodes).toBe(1);
  });

  it('does not guess when a same-name node already exists', () => {
    tech.createNode(domainId, { name: 'Duplicate Name', nodeType: 'component' });
    const softwareId = createSoftware('Duplicate Name');
    const result = preview({
      scopeType: 'software',
      software: { ids: [softwareId] },
      mapping: { domainId, linkStrategy: 'create_node', nodeType: 'component' },
    });
    expect(result.counts.pending).toBe(1);
    expect(result.items[0].reason).toContain('同名节点');
  });

  it('rejects a stale preview hash and an unconfirmed execution', () => {
    const softwareId = createSoftware('Hash Tool');
    const request: KnowledgeBuildRequest = {
      scopeType: 'software',
      software: { ids: [softwareId] },
      mapping: { domainId, linkStrategy: 'create_node', nodeType: 'component' },
    };
    expect(() => build.executeKnowledgeBuild(request)).toThrow(/确认预览/);
    const first = preview(request);
    expect(() =>
      build.executeKnowledgeBuild({
        ...request,
        confirmed: true,
        previewId: first.previewId,
        previewHash: `${first.previewHash}changed`,
      }),
    ).toThrow(/不一致|重新预览/);
  });

  it('creates new knowledge nodes without requiring a software association', () => {
    const request: KnowledgeBuildRequest = {
      scopeType: 'new',
      newNode: {
        domainId,
        name: 'Raft 共识',
        nodeType: 'protocol',
      },
      templateKey: 'protocol-l2-v1',
      sources: {
        referenceLinks: [
          { label: '论文', url: 'https://raft.github.io/raft.pdf' },
          { label: '说明', url: 'https://raft.github.io/' },
        ],
      },
    };
    const first = preview(request);
    expect(first.counts.createNode).toBe(1);
    const result = execute(request);
    expect(result.counts.created).toBe(1);
    const node = tech.getNode(result.items[0].nodeId!)!;
    expect(node.nodeType).toBe('protocol');
    expect(tech.getNodeDetail(node.id)!.software).toHaveLength(0);
    expect(node.contentMarkdown).toContain('## 技术定位');
  });
});

describe('preview snapshot binding', () => {
  it('returns a persisted preview id, candidate hash and expiry', () => {
    const softwareId = createSoftware('Snapshot Persist Tool');
    const request: KnowledgeBuildRequest = {
      scopeType: 'software',
      software: { ids: [softwareId] },
      mapping: { domainId, linkStrategy: 'create_node', nodeType: 'component' },
    };
    const first = preview(request);
    expect(first.previewId).toBeTruthy();
    expect(new Date(first.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const row = dbModule.db
      .prepare('SELECT * FROM tech_knowledge_build_previews WHERE id = ?')
      .get(first.previewId) as {
      request_hash: string;
      candidate_hash: string;
      candidate_snapshot: string;
      consumed_at: string | null;
    };
    expect(row.request_hash).toBe(first.previewHash);
    expect(row.candidate_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(row.candidate_snapshot).length).toBe(first.items.length);
    expect(row.consumed_at).toBeNull();
  });

  it('rejects execution when the candidate set or metadata changed', () => {
    const softwareId = createSoftware('Snapshot Drift Tool');
    const request: KnowledgeBuildRequest = {
      scopeType: 'software',
      software: { ids: [softwareId] },
      mapping: { domainId, linkStrategy: 'create_node', nodeType: 'component' },
    };
    const first = preview(request);
    dbModule.db
      .prepare('UPDATE software SET latest_version = ? WHERE id = ?')
      .run('99.0.0', softwareId);
    expect(() =>
      build.executeKnowledgeBuild({
        ...request,
        confirmed: true,
        previewId: first.previewId,
        previewHash: first.previewHash,
      }),
    ).toThrow(/预览范围发生变化/);
    expect(
      dbModule.db
        .prepare('SELECT consumed_at FROM tech_knowledge_build_previews WHERE id = ?')
        .get(first.previewId),
    ).toEqual({ consumed_at: null });
  });

  it('rejects execution when a target document was modified after preview', () => {
    const node = tech.createNode(domainId, { name: 'Snapshot Doc Target', nodeType: 'concept' });
    const request: KnowledgeBuildRequest = {
      scopeType: 'nodes',
      nodes: { ids: [node.id] },
      templateKey: 'concept-l2-v1',
    };
    const first = preview(request);
    tech.updateNode(node.id, { contentMarkdown: 'CHANGED AFTER PREVIEW' });
    expect(() =>
      build.executeKnowledgeBuild({
        ...request,
        confirmed: true,
        previewId: first.previewId,
        previewHash: first.previewHash,
      }),
    ).toThrow(/预览范围发生变化/);
    expect(tech.getNode(node.id)!.contentMarkdown).toBe('CHANGED AFTER PREVIEW');
  });

  it('rejects a request that does not match the preview and expired previews', () => {
    const softwareId = createSoftware('Snapshot Expiry Tool');
    const request: KnowledgeBuildRequest = {
      scopeType: 'software',
      software: { ids: [softwareId] },
      mapping: { domainId, linkStrategy: 'create_node', nodeType: 'component' },
    };
    const first = preview(request);
    expect(() =>
      build.executeKnowledgeBuild({
        ...request,
        sources: { docsUrl: 'https://example.com/other' },
        confirmed: true,
        previewId: first.previewId,
        previewHash: first.previewHash,
      }),
    ).toThrow(/不一致/);

    const second = preview(request);
    dbModule.db
      .prepare('UPDATE tech_knowledge_build_previews SET expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), second.previewId);
    expect(() =>
      build.executeKnowledgeBuild({
        ...request,
        confirmed: true,
        previewId: second.previewId,
        previewHash: second.previewHash,
      }),
    ).toThrow(/不存在或已经过期/);
  });

  it('consumes a preview only once', () => {
    const softwareId = createSoftware('Snapshot Once Tool');
    const request: KnowledgeBuildRequest = {
      scopeType: 'software',
      software: { ids: [softwareId] },
      mapping: { domainId, linkStrategy: 'create_node', nodeType: 'component' },
    };
    const first = preview(request);
    const result = build.executeKnowledgeBuild({
      ...request,
      confirmed: true,
      previewId: first.previewId,
      previewHash: first.previewHash,
    });
    expect(result.counts.created).toBe(1);
    expect(() =>
      build.executeKnowledgeBuild({
        ...request,
        confirmed: true,
        previewId: first.previewId,
        previewHash: first.previewHash,
      }),
    ).toThrow(/已经执行/);
  });
});

describe('association and document initialization boundaries', () => {
  function linkRequest(softwareId: string, nodeId: string): KnowledgeBuildRequest {
    return {
      scopeType: 'software',
      software: { ids: [softwareId] },
      mapping: { linkStrategy: 'link_existing', nodeId, initializeOnLink: false },
    };
  }

  function softwareLinkCount(nodeId: string, softwareId: string): number {
    return (
      dbModule.db
        .prepare('SELECT COUNT(*) AS count FROM tech_node_software WHERE node_id = ? AND software_id = ?')
        .get(nodeId, softwareId) as { count: number }
    ).count;
  }

  it('links to an existing node with a body without touching the body', () => {
    const node = tech.createNode(domainId, {
      name: 'Link Body Target',
      nodeType: 'component',
      contentMarkdown: 'BODY MUST NOT CHANGE',
    });
    const softwareId = createSoftware('Link Body Tool');
    const first = preview(linkRequest(softwareId, node.id));
    expect(first.items[0].action).toBe('link_existing');
    const result = execute(linkRequest(softwareId, node.id));
    expect(result.counts.linked).toBe(1);
    expect(tech.getNode(node.id)!.contentMarkdown).toBe('BODY MUST NOT CHANGE');
    expect(softwareLinkCount(node.id, softwareId)).toBe(1);
  });

  it('links to an empty node without initializing unless requested', () => {
    const node = tech.createNode(domainId, { name: 'Link Empty Target', nodeType: 'component' });
    const softwareId = createSoftware('Link Empty Tool');
    const first = preview(linkRequest(softwareId, node.id));
    expect(first.items[0].action).toBe('link_existing');
    const result = execute(linkRequest(softwareId, node.id));
    expect(result.counts.linked).toBe(1);
    expect(tech.getNode(node.id)!.contentMarkdown ?? null).toBeNull();
    expect(softwareLinkCount(node.id, softwareId)).toBe(1);
  });

  it('links and initializes in one action when requested', () => {
    const node = tech.createNode(domainId, { name: 'Link Init Target', nodeType: 'component' });
    const softwareId = createSoftware('Link Init Tool');
    const request: KnowledgeBuildRequest = {
      scopeType: 'software',
      software: { ids: [softwareId] },
      mapping: { linkStrategy: 'link_existing', nodeId: node.id, initializeOnLink: true },
      templateKey: 'component-l2-v1',
    };
    const first = preview(request);
    expect(first.items[0].action).toBe('link_and_initialize');
    expect(first.counts.linkAndInitialize).toBe(1);
    const result = execute(request);
    expect(result.counts.linked).toBe(1);
    const saved = tech.getNode(node.id)!;
    expect(saved.contentStatus).toBe('draft');
    expect(saved.contentMarkdown).toContain('## 技术定位');
    expect(softwareLinkCount(node.id, softwareId)).toBe(1);

    // Running the same request again must not duplicate the association.
    const second = execute(request);
    expect(second.items[0].status).not.toBe('failed');
    expect(softwareLinkCount(node.id, softwareId)).toBe(1);
  });

  it('does not leave an association when the document changed after preview', () => {
    const node = tech.createNode(domainId, { name: 'Link Rollback Target', nodeType: 'component' });
    const softwareId = createSoftware('Link Rollback Tool');
    const request: KnowledgeBuildRequest = {
      scopeType: 'software',
      software: { ids: [softwareId] },
      mapping: { linkStrategy: 'link_existing', nodeId: node.id, initializeOnLink: true },
    };
    const first = preview(request);
    tech.updateNode(node.id, { contentMarkdown: 'CONCURRENT BODY' });
    expect(() =>
      build.executeKnowledgeBuild({
        ...request,
        confirmed: true,
        previewId: first.previewId,
        previewHash: first.previewHash,
      }),
    ).toThrow(/预览范围发生变化/);
    expect(softwareLinkCount(node.id, softwareId)).toBe(0);
    expect(tech.getNode(node.id)!.contentMarkdown).toBe('CONCURRENT BODY');
  });
});

describe('strict HTTPS source intake', () => {
  it('rejects HTTP manual sources and rule sources', () => {
    expect(() =>
      tech.createNode(domainId, {
        name: 'Direct HTTP Node',
        nodeType: 'concept',
        docsUrl: 'http://example.com/direct',
      }),
    ).toThrow(/HTTPS/);
    expect(() =>
      preview({
        scopeType: 'new',
        newNode: { domainId, name: 'HTTP Source', nodeType: 'concept' },
        sources: { docsUrl: 'http://example.com/docs' },
      }),
    ).toThrow(/HTTPS/);
    expect(() =>
      preview({
        scopeType: 'new',
        newNode: { domainId, name: 'HTTP Ref Source', nodeType: 'concept' },
        sources: { referenceLinks: [{ label: '旧来源', url: 'http://example.com/ref' }] },
      }),
    ).toThrow(/HTTPS/);
    expect(() =>
      build.createKnowledgeBuildRule({
        name: 'HTTP 来源规则',
        targetType: 'software',
        triggerType: 'software_created',
        scopeType: 'software',
        mappingConfig: { domainId, linkStrategy: 'create_node' },
        templateKey: 'component-l2-v1',
        sourceConfig: { docsUrl: 'http://example.com/docs' },
      }),
    ).toThrow(/HTTPS/);
  });

  it('deduplicates new HTTPS sources and keeps historical HTTP rows only for linting', async () => {
    const request: KnowledgeBuildRequest = {
      scopeType: 'new',
      newNode: { domainId, name: 'Dedup Source', nodeType: 'concept' },
      sources: {
        docsUrl: 'https://example.com/same',
        referenceLinks: [
          { label: '同一来源', url: 'https://example.com/same' },
          { label: '另一来源', url: 'https://example.com/other' },
        ],
      },
    };
    const first = preview(request);
    const result = execute(request);
    const nodeId = result.items[0].nodeId!;
    const detail = tech.getNodeDetail(nodeId)!;
    const urls = [
      ...(detail.node.docsUrl ? [detail.node.docsUrl] : []),
      ...detail.node.referenceLinks.map((link) => link.url),
    ];
    expect(new Set(urls).size).toBe(urls.length);
    expect(first.items[0].action).toBe('create_node');

    const legacy = tech.createNode(domainId, {
      name: 'Legacy HTTP Source',
      nodeType: 'concept',
      docsUrl: 'https://legacy.example.com/docs',
      referenceLinks: [{ label: '旧文档', url: 'https://legacy.example.com/old' }],
      contentMarkdown: 'LEGACY BODY',
    });
    // Simulate a historical row written before strict HTTPS was enforced.
    dbModule.db
      .prepare('UPDATE tech_nodes SET docs_url = ?, reference_links = ? WHERE id = ?')
      .run(
        'http://legacy.example.com/docs',
        JSON.stringify([{ label: '旧文档', url: 'http://legacy.example.com/old' }]),
        legacy.id,
      );
    const lint = await build.lintNodeKnowledge(legacy.id);
    const sourceFormat = lint.items.find((item) => item.rule === 'source-format');
    expect(sourceFormat?.severity).toBe('fail');
    expect(sourceFormat?.message).toContain('历史记录保留');
    expect(tech.getNode(legacy.id)!.docsUrl).toBe('http://legacy.example.com/docs');
    expect(() =>
      tech.updateNode(legacy.id, {
        summary: '保留历史来源的编辑',
        docsUrl: 'http://legacy.example.com/docs',
        referenceLinks: [{ label: '旧文档', url: 'http://legacy.example.com/old' }],
      }),
    ).not.toThrow();
    expect(() =>
      tech.updateNode(legacy.id, {
        docsUrl: 'http://legacy.example.com/new-docs',
      }),
    ).toThrow(/HTTPS/);
  });
});

describe('new node summary', () => {
  it('stores summary in summary and does not duplicate it into description', () => {
    const request: KnowledgeBuildRequest = {
      scopeType: 'new',
      newNode: {
        domainId,
        name: 'Summary Node',
        nodeType: 'concept',
        summary: '已确认的一句话摘要。',
      },
      templateKey: 'concept-l2-v1',
    };
    const result = execute(request);
    const saved = tech.getNode(result.items[0].nodeId!)!;
    expect(saved.summary).toBe('已确认的一句话摘要。');
    expect(saved.description ?? null).toBeNull();
    expect(() =>
      preview({
        scopeType: 'new',
        newNode: {
          domainId,
          name: 'Summary Too Long',
          nodeType: 'concept',
          summary: 'x'.repeat(501),
        },
      }),
    ).toThrow(/500/);
  });
});

describe('linter', () => {
  it('reports structure, sources and placeholders without changing contentStatus', async () => {
    const parent = tech.createNode(domainId, { name: 'Lint Parent', nodeType: 'component' });
    const softwareId = createSoftware('Lint Tool');
    const result = execute({
      scopeType: 'software',
      software: { ids: [softwareId] },
      mapping: { domainId, parentId: parent.id, linkStrategy: 'create_node', nodeType: 'component' },
    });
    const nodeId = result.items[0].nodeId!;
    const node = tech.getNode(nodeId)!;
    tech.updateNode(nodeId, {
      contentMarkdown: `${node.contentMarkdown}\n\nTODO 补充容量边界说明\n`,
    });
    const lint = await build.lintNodeKnowledge(nodeId);
    expect(lint.status).toBe('fail');
    expect(lint.items.find((item) => item.rule === 'structure')?.severity).toBe('pass');
    expect(lint.items.find((item) => item.rule === 'length')?.severity).toBe('fail');
    expect(lint.items.find((item) => item.rule === 'placeholder')?.severity).toBe('warning');
    expect(lint.items.find((item) => item.rule === 'official-sources')?.severity).toBe('pass');
    expect(tech.getNode(nodeId)!.contentStatus).toBe('draft');
  });

  it('ignores template comments and fixed version/reference hints for placeholders', async () => {
    const request: KnowledgeBuildRequest = {
      scopeType: 'new',
      newNode: { domainId, name: 'Clean Template', nodeType: 'concept' },
      templateKey: 'concept-l2-v1',
      sources: {
        referenceLinks: [
          { label: '文档', url: 'https://example.com/clean-one' },
          { label: '规范', url: 'https://example.com/clean-two' },
        ],
      },
    };
    const nodeId = execute(request).items[0].nodeId!;
    const lint = await build.lintNodeKnowledge(nodeId);
    const placeholder = lint.items.find((item) => item.rule === 'placeholder');
    expect(placeholder?.severity).toBe('pass');
  });

  it('uses structured relation review instead of text keywords', async () => {
    const node = tech.createNode(domainId, {
      name: 'Independent Keyword Node',
      nodeType: 'concept',
      contentMarkdown: '这是一个独立主题，但没有人工确认记录。',
    });
    const lint = await build.lintNodeKnowledge(node.id);
    const relation = lint.items.find((item) => item.rule === 'relations');
    expect(relation?.severity).toBe('warning');
    expect(relation?.message).toContain('人工确认');

    expect(() =>
      tech.updateNodeRelationReview(node.id, { status: 'independent', note: '' }),
    ).toThrow(/原因/);

    tech.updateNodeRelationReview(node.id, {
      status: 'independent',
      note: '该节点是独立术语，没有上下游依赖。',
    });
    const reviewed = await build.lintNodeKnowledge(node.id);
    expect(reviewed.items.find((item) => item.rule === 'relations')?.severity).toBe('pass');

    const peer = tech.createNode(domainId, { name: 'Relation Peer', nodeType: 'concept' });
    tech.createRelation({
      sourceNodeId: node.id,
      targetNodeId: peer.id,
      relationType: 'related',
    });
    const withRelation = await build.lintNodeKnowledge(node.id);
    expect(withRelation.items.find((item) => item.rule === 'relations')?.severity).toBe('pass');
  });

  it('reports the placeholder section and snippet', async () => {
    const node = tech.createNode(domainId, {
      name: 'Placeholder Location',
      nodeType: 'concept',
      contentMarkdown: '## 技术定位\n\nTODO 补充适用边界\n',
    });
    const lint = await build.lintNodeKnowledge(node.id);
    const placeholder = lint.items.find((item) => item.rule === 'placeholder');
    expect(placeholder?.severity).toBe('warning');
    expect(placeholder?.section).toBe('技术定位');
    expect(placeholder?.snippet).toContain('TODO 补充适用边界');
  });
});

describe('automatic rules', () => {
  it('creates configured nodes on software creation and persists unresolved candidates', () => {
    const configured = build.createKnowledgeBuildRule({
      name: '自动创建组件节点',
      targetType: 'software',
      triggerType: 'software_created',
      scopeType: 'software',
      scopeConfig: { category: '测试软件' },
      mappingConfig: { domainId, linkStrategy: 'create_node', nodeType: 'component' },
      templateKey: 'component-l2-v1',
      sourceConfig: {
        referenceLinks: [
          { label: '文档', url: 'https://example.com/auto/docs' },
          { label: '源码', url: 'https://example.com/auto/repo' },
        ],
      },
    });
    const softwareId = createSoftware('Auto Tool');
    const runs = build.runKnowledgeBuildRules('software_created', { softwareId });
    expect(runs.find((run) => run.ruleId === configured.id)?.status).toBe('success');
    const node = tech.listNodes({ domainId, status: 'active' }).items.find(
      (item) => item.name === 'Auto Tool',
    );
    expect(node).toBeTruthy();
    expect(tech.getNode(node!.id)!.contentStatus).toBe('draft');

    const unresolved = build.createKnowledgeBuildRule({
      name: '缺少目标领域',
      targetType: 'software',
      triggerType: 'software_created',
      scopeType: 'software',
      mappingConfig: { linkStrategy: 'create_node', nodeType: 'component' },
      templateKey: 'component-l2-v1',
    });
    const otherSoftwareId = createSoftware('Needs Mapping');
    const secondRuns = build.runKnowledgeBuildRules('software_created', {
      softwareId: otherSoftwareId,
    });
    expect(secondRuns.find((run) => run.ruleId === unresolved.id)?.status).toBe('pending');
    const pending = build.listKnowledgeBuildPending();
    expect(pending.some((item) => item.ruleId === unresolved.id)).toBe(true);

    build.updateKnowledgeBuildRule(configured.id, { enabled: false });
    const disabledRun = build.runKnowledgeBuildRules('software_created', {
      softwareId: createSoftware('Disabled Rule Tool'),
    });
    expect(disabledRun.some((run) => run.ruleId === configured.id)).toBe(false);
  });

  it('updates a rule with the full configuration and validates new sources', () => {
    const rule = build.createKnowledgeBuildRule({
      name: '待编辑规则',
      targetType: 'software',
      triggerType: 'software_created',
      scopeType: 'software',
      scopeConfig: { category: '旧分类' },
      mappingConfig: { domainId, linkStrategy: 'create_node', nodeType: 'component' },
      templateKey: 'component-l2-v1',
      sourceConfig: {
        referenceLinks: [{ label: '旧来源', url: 'https://example.com/old' }],
      },
    });
    const updated = build.updateKnowledgeBuildRule(rule.id, {
      name: '已编辑规则',
      scopeConfig: { category: '新分类' },
      mappingConfig: {
        domainId,
        parentId: null,
        nodeType: 'concept',
        linkStrategy: 'link_existing',
        initializeOnLink: true,
      },
      templateKey: 'concept-l2-v1',
      sourceConfig: {
        docsUrl: 'https://example.com/new-docs',
        referenceLinks: [{ label: '新来源', url: 'https://example.com/new-ref' }],
      },
    });
    expect(updated.name).toBe('已编辑规则');
    expect(updated.scopeConfig.category).toBe('新分类');
    expect(updated.mappingConfig.nodeType).toBe('concept');
    expect(updated.mappingConfig.linkStrategy).toBe('link_existing');
    expect(updated.mappingConfig.initializeOnLink).toBe(true);
    expect(updated.templateKey).toBe('concept-l2-v1');
    expect(updated.sourceConfig.docsUrl).toBe('https://example.com/new-docs');
    expect(() =>
      build.updateKnowledgeBuildRule(rule.id, {
        sourceConfig: {
          referenceLinks: [{ label: 'HTTP', url: 'http://example.com/legacy' }],
        },
      }),
    ).toThrow(/HTTPS/);
  });

  it('initializes a newly created node only when a matching rule exists', () => {
    const rule = build.createKnowledgeBuildRule({
      name: '协议节点自动初始化',
      targetType: 'node',
      triggerType: 'node_created',
      scopeType: 'nodes',
      scopeConfig: { domainId, nodeType: 'protocol' },
      templateKey: 'protocol-l2-v1',
    });
    const node = tech.createNode(domainId, { name: 'Auto Protocol', nodeType: 'protocol' });
    const runs = build.runKnowledgeBuildRules('node_created', { nodeId: node.id });
    expect(runs.find((run) => run.ruleId === rule.id)?.status).toBe('success');
    const saved = tech.getNode(node.id)!;
    expect(saved.contentStatus).toBe('draft');
    expect(saved.contentMarkdown).toContain('## 设计原理');
  });
});

describe('URL checker SSRF boundaries', () => {
  it('rejects localhost, private ranges, metadata and non-HTTPS without making requests', async () => {
    const results = await urlcheck.checkKnowledgeUrls([
      'http://example.com/docs',
      'https://localhost/docs',
      'https://127.0.0.1/docs',
      'https://10.1.2.3/docs',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/docs',
      'https://[fd00::1]/docs',
      'https://[::7f00:1]/docs',
      'https://[64:ff9b::a00:1]/docs',
      'https://[2002:a00:1::]/docs',
      'https://[2001:db8::1]/docs',
      'not-a-url',
    ]);
    expect(results).toHaveLength(12);
    expect(results.every((result) => ['blocked', 'invalid'].includes(result.status))).toBe(true);
    expect(results.find((result) => result.url === 'http://example.com/docs')?.error).toContain('HTTPS');
    expect(results.find((result) => result.url.includes('169.254'))?.error).toMatch(/内网|本机|保留/);
  });
});
