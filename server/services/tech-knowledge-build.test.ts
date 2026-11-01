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
        previewHash: `${first.previewHash}changed`,
      }),
    ).toThrow(/重新预览/);
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
    const lint = await build.lintNodeKnowledge(nodeId);
    expect(lint.status).toBe('fail');
    expect(lint.items.find((item) => item.rule === 'structure')?.severity).toBe('pass');
    expect(lint.items.find((item) => item.rule === 'length')?.severity).toBe('fail');
    expect(lint.items.find((item) => item.rule === 'placeholder')?.severity).toBe('warning');
    expect(lint.items.find((item) => item.rule === 'official-sources')?.severity).toBe('pass');
    expect(tech.getNode(nodeId)!.contentStatus).toBe('draft');
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
