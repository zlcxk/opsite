import type {
  KnowledgeBuildTemplate,
  KnowledgeBuildTemplateKey,
  TechExternalLink,
  TechNodeType,
} from '../../shared/types.js';

/**
 * Standardized document skeletons.
 *
 * The prompts are HTML comments on purpose: they are editor hints, not content.
 * A generated skeleton is a normalized draft plus an official-source frame. It
 * never contains a technical conclusion that was not already present in the
 * node's structured fields.
 */
export interface KnowledgeTemplateSection {
  key: string;
  title: string;
  prompt: string;
}

export interface KnowledgeTemplateDefinition extends KnowledgeBuildTemplate {
  sections: KnowledgeTemplateSection[];
}

const SECTION_TITLES = [
  '技术定位',
  '设计原理',
  '工作机制',
  '关键配置与实践',
  '版本差异与兼容性',
  '常见问题与限制',
  '技术关联',
  '参考资料',
] as const;

function sections(prompts: Record<(typeof SECTION_TITLES)[number], string>): KnowledgeTemplateSection[] {
  return SECTION_TITLES.map((title) => ({
    key: title,
    title,
    prompt: prompts[title],
  }));
}

export const KNOWLEDGE_BUILD_TEMPLATES: KnowledgeTemplateDefinition[] = [
  {
    key: 'component-l2-v1',
    version: 1,
    name: '软件 / 组件型 L2',
    description: '用于具体软件、组件或运行时。重点是它解决什么问题、内部如何协作、如何配置和排障。',
    nodeType: 'component',
    sections: sections({
      技术定位: '说明这个组件属于哪一层、解决什么问题、不适合什么场景。不要把官网宣传语当作定位。',
      设计原理: '说明核心设计取舍、数据或控制流、关键抽象。只写能够从官方架构文档核实的原理。',
      工作机制: '按请求、任务或事件的生命周期描述内部协作，区分控制面与数据面。',
      关键配置与实践: '列出真正影响行为的配置项、默认值、部署边界和可观测指标，并注明适用版本。',
      版本差异与兼容性: '区分安装版本、上游最新版本、文档适用版本和实际核实版本，说明不兼容变更。',
      常见问题与限制: '记录可复现的失败模式、容量边界、已知限制和排查入口；没有证据的猜测请留在待核实。',
      技术关联: '说明与上下游组件、替代方案或协议的关系。若确为独立主题，请写出独立原因。',
      参考资料: '至少保留两个可访问的官方来源，优先使用版本化文档、发布说明和源码仓库。',
    }),
  },
  {
    key: 'concept-l2-v1',
    version: 1,
    name: '技术概念型 L2',
    description: '用于概念、模型或机制。重点是定义边界、解释为什么存在，而不是堆叠组件清单。',
    nodeType: 'concept',
    sections: sections({
      技术定位: '给出可操作的定义，说明它属于哪个技术体系、回答什么问题，以及与相邻概念的区别。',
      设计原理: '解释概念背后的约束、假设和取舍。概念文档不要求部署步骤，但必须说明为什么这样设计。',
      工作机制: '描述概念在系统中的表现形式、状态变化和参与方，给出一个最小例子。',
      关键配置与实践: '说明在真实系统中如何观察、启用或影响这个概念，避免列出与该概念无关的通用配置。',
      版本差异与兼容性: '标明概念在不同版本或规范中的名称、语义和默认行为变化。',
      常见问题与限制: '列出常见误解、边界条件和不适用的场景。',
      技术关联: '连接到相关概念、实现或规范；若概念独立存在，请说明独立性。',
      参考资料: '使用规范、官方概念文档或设计文档，至少两个来源。',
    }),
  },
  {
    key: 'protocol-l2-v1',
    version: 1,
    name: '协议型 L2',
    description: '用于通信协议、接口规范或数据交换格式。重点是消息流程、状态机、兼容性和安全边界。',
    nodeType: 'protocol',
    sections: sections({
      技术定位: '说明协议位于哪一层、解决什么通信问题、与相邻协议的分工。',
      设计原理: '解释帧或消息结构、状态机、错误模型和安全假设。',
      工作机制: '描述握手、传输、重试、关闭或异常路径，区分规范要求与实现选择。',
      关键配置与实践: '列出超时、重试、认证、TLS、报文大小等关键参数，并说明它们的协议语义。',
      版本差异与兼容性: '说明协议版本协商、扩展字段、弃用行为和实现兼容矩阵。',
      常见问题与限制: '记录互操作问题、超时与重试放大、代理兼容性和安全限制。',
      技术关联: '关联实现、承载协议、依赖协议或替代协议。',
      参考资料: '优先引用 RFC、官方规范、版本化 API 文档和参考实现。',
    }),
  },
  {
    key: 'resource-l2-v1',
    version: 1,
    name: '资源对象型 L2',
    description: '用于 API 对象、资源模型或配置实体。重点是字段语义、生命周期、控制器行为和迁移边界。',
    nodeType: 'resource',
    sections: sections({
      技术定位: '说明这个资源对象代表什么、由谁管理、在系统中的位置。',
      设计原理: '解释对象模型、期望状态、所有权和不可变字段。',
      工作机制: '描述创建、更新、删除、回收和状态收敛过程，注明控制器或执行者。',
      关键配置与实践: '列出关键字段、默认值、校验规则、权限和典型清单，避免复制完整 API 参考。',
      版本差异与兼容性: '标明 API 版本、字段废弃、转换和升级注意事项。',
      常见问题与限制: '记录冲突、漂移、级联删除、配额和不可变字段带来的限制。',
      技术关联: '关联所属系统、控制器、依赖资源和相关对象。',
      参考资料: '引用版本化 API 参考、官方任务文档和源码定义。',
    }),
  },
  {
    key: 'practice-l2-v1',
    version: 1,
    name: '实践方法型 L2',
    description: '用于方法、流程或运维实践。重点是适用条件、步骤、验证方式和失败回退。',
    nodeType: 'practice',
    sections: sections({
      技术定位: '说明实践解决什么问题、适用前提和不适用场景。',
      设计原理: '解释实践背后的原则与权衡，避免把某个团队的具体流程当成通用规律。',
      工作机制: '描述步骤、角色、输入输出和反馈回路。',
      关键配置与实践: '列出执行参数、检查点、回滚条件和可观测指标。',
      版本差异与兼容性: '说明工具链版本、平台差异和流程变更对实践的影响。',
      常见问题与限制: '记录常见失败、组织约束、自动化的边界和人工判断点。',
      技术关联: '关联依赖的工具、规范、替代实践和上游概念。',
      参考资料: '优先引用官方运行手册、标准、版本化文档和公开案例。',
    }),
  },
];

const TEMPLATE_BY_KEY = new Map(KNOWLEDGE_BUILD_TEMPLATES.map((template) => [template.key, template]));

export function isKnowledgeBuildTemplateKey(value: string): value is KnowledgeBuildTemplateKey {
  return TEMPLATE_BY_KEY.has(value as KnowledgeBuildTemplateKey);
}

export function getKnowledgeBuildTemplate(key: string): KnowledgeTemplateDefinition | null {
  return TEMPLATE_BY_KEY.get(key as KnowledgeBuildTemplateKey) ?? null;
}

export function defaultTemplateKeyForNodeType(nodeType: TechNodeType): KnowledgeBuildTemplateKey {
  switch (nodeType) {
    case 'component':
      return 'component-l2-v1';
    case 'protocol':
      return 'protocol-l2-v1';
    case 'resource':
      return 'resource-l2-v1';
    case 'practice':
      return 'practice-l2-v1';
    default:
      return 'concept-l2-v1';
  }
}

export interface KnowledgeDocumentContext {
  name: string;
  nodeType: TechNodeType;
  summary?: string | null;
  description?: string | null;
  technicalRole?: string | null;
  corePrinciple?: string | null;
  solvedProblem?: string | null;
  keyMechanism?: string | null;
  useCases?: string | null;
  commonIssues?: string | null;
  docsUrl?: string | null;
  repoUrl?: string | null;
  referenceLinks?: TechExternalLink[];
  applicableVersions?: string | null;
  currentVersion?: string | null;
  latestVersion?: string | null;
  category?: string | null;
  website?: string | null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function prompt(section: KnowledgeTemplateSection): string {
  return `<!-- 写作提示：${section.prompt} -->`;
}

function joinFacts(facts: Array<string | null>): string {
  return facts.filter((fact): fact is string => Boolean(fact)).join('\n\n');
}

function uniqueOfficialLinks(context: KnowledgeDocumentContext): TechExternalLink[] {
  const seen = new Set<string>();
  const links: TechExternalLink[] = [];
  const add = (label: string, url: string | null | undefined) => {
    const trimmed = url?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    if (!/^https:\/\//i.test(trimmed)) return;
    seen.add(trimmed);
    links.push({ label, url: trimmed });
  };
  add('官方文档', context.docsUrl);
  add('源码仓库', context.repoUrl);
  add('官方网站', context.website);
  for (const link of context.referenceLinks ?? []) {
    add(link.label || '官方资料', link.url);
  }
  return links;
}

function renderBody(
  section: KnowledgeTemplateSection,
  context: KnowledgeDocumentContext,
  officialLinks: TechExternalLink[],
): string[] {
  const lines: string[] = [prompt(section)];
  switch (section.title) {
    case '技术定位': {
      const known = clean(context.description) ?? clean(context.summary);
      if (known) lines.push('', known);
      if (context.category) lines.push('', `已录入分类：${context.category}。`);
      break;
    }
    case '设计原理': {
      const known = clean(context.corePrinciple) ?? clean(context.technicalRole);
      if (known) lines.push('', known);
      break;
    }
    case '工作机制': {
      const known = joinFacts([clean(context.keyMechanism), clean(context.solvedProblem)]);
      if (known) lines.push('', known);
      break;
    }
    case '关键配置与实践': {
      const known = clean(context.useCases);
      if (known) lines.push('', known);
      if (context.currentVersion) {
        lines.push('', `当前安装版本：${context.currentVersion}。`);
      }
      break;
    }
    case '版本差异与兼容性': {
      lines.push(
        '',
        '| 版本维度 | 当前记录 |',
        '| --- | --- |',
        `| 安装 / 使用版本 | ${clean(context.currentVersion) ?? '未记录'} |`,
        `| 上游最新版本 | ${clean(context.latestVersion) ?? '未核实'} |`,
        `| 文档适用版本 | ${clean(context.applicableVersions) ?? '待核实，未写入 applicableVersions'} |`,
        '| 本文实际核实版本 | 未核实 |',
        '',
        '以上只区分版本来源，不代表已经验证兼容性。',
      );
      break;
    }
    case '常见问题与限制': {
      const known = clean(context.commonIssues);
      if (known) lines.push('', known);
      break;
    }
    case '技术关联': {
      lines.push(
        '',
        '尚未在本节点建立技术关联。若它与上下游组件、协议或替代方案存在关系，请在确认依据后补充；若确为独立主题，请在此说明独立原因。',
      );
      break;
    }
    case '参考资料': {
      if (officialLinks.length) {
        lines.push('');
        for (const link of officialLinks) {
          lines.push(`- [${link.label}](${link.url})`);
        }
      } else {
        lines.push('', '尚未录入官方来源。请添加官方文档、API 参考、发布说明或源码仓库；没有来源时不要标记为已核实。');
      }
      break;
    }
    default:
      break;
  }
  return lines;
}

export function renderKnowledgeDocument(
  template: KnowledgeTemplateDefinition,
  context: KnowledgeDocumentContext,
): string {
  const officialLinks = uniqueOfficialLinks(context);
  const parts: string[] = [
    `<!-- opsite:template=${template.key};template-version=${template.version};initialized=true -->`,
    `<!-- 本文档由「${template.name}」模板初始化为草稿。章节提示不会自动生成技术结论。 -->`,
  ];
  for (const section of template.sections) {
    parts.push(`## ${section.title}`, ...renderBody(section, context, officialLinks));
  }
  return `${parts.join('\n')}\n`;
}

/** Personal notes are never part of generated Markdown. */
export function sourceLinksForContext(context: KnowledgeDocumentContext): TechExternalLink[] {
  return uniqueOfficialLinks(context);
}
