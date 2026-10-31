import { describe, expect, it } from 'vitest';
import { KUBERNETES_DOCS } from './tech-content-kubernetes-docs.js';

function doc(nodeId: string) {
  const entry = KUBERNETES_DOCS.find((item) => item.nodeId === nodeId);
  if (!entry?.contentMarkdown) throw new Error(`missing document: ${nodeId}`);
  return entry;
}

describe('P5.4.1 Kubernetes sample documents', () => {
  it('keeps the Pod QoS, Pod-level resource and eviction corrections', () => {
    const entry = doc('k8s-pod');
    expect(entry.version).toBe(3);
    expect(entry.replacesContentHash).toBe(
      '843eacb1a5e965fc554c842bc724ea8282dd9533b9ef68661787c474a8224b6c',
    );
    expect(entry.contentMarkdown).toContain('每个容器都同时设置 CPU 和内存');
    expect(entry.contentMarkdown).toContain('Pod 级资源');
    expect(entry.contentMarkdown).toContain('PodLevelResources');
    expect(entry.contentMarkdown).toContain('1.34 进入 Beta');
    expect(entry.contentMarkdown).toContain('Guaranteed 只是最不容易');
    expect(entry.contentMarkdown).toContain('并非免疫');
    expect(entry.contentMarkdown).toContain('不是容量规划');
  });

  it('keeps selected endpoints, ready/serving/terminating and Pod Ready dependencies distinct', () => {
    const entry = doc('k8s-service');
    expect(entry.version).toBe(3);
    expect(entry.replacesContentHash).toBe(
      '7545b630d27792ac92b14fa12ddf7c4a7b1896d81676255c833ff658e0f554df',
    );
    expect(entry.contentMarkdown).toContain('被 selector 选中的端点');
    expect(entry.contentMarkdown).toContain('serving 且未 terminating');
    expect(entry.contentMarkdown).toContain('readinessGates');
    expect(entry.contentMarkdown).toContain('serving 且 terminating');
    expect(entry.contentMarkdown).toContain('EndpointSlice API reference');
  });

  it('documents event-driven requeue and QueueingHint version boundaries', () => {
    const entry = doc('k8s-scheduler');
    expect(entry.version).toBe(3);
    expect(entry.replacesContentHash).toBe(
      'ed02356a1fd408738f5af436df9443889b59b55ac0a6e4d4372013f70518ee1f',
    );
    expect(entry.contentMarkdown).toContain('重新入队与 QueueingHint');
    expect(entry.contentMarkdown).toContain('unschedulableQ');
    expect(entry.contentMarkdown).toContain('EnqueueExtension');
    expect(entry.contentMarkdown).toContain('1.29–1.31 默认关闭');
    expect(entry.contentMarkdown).toContain('不是调度周期的一个阶段');
  });

  it('leaves the reviewed Deployment and Controller Manager samples at version 2', () => {
    for (const nodeId of ['k8s-deployment', 'k8s-controller-manager']) {
      const entry = doc(nodeId);
      expect(entry.version).toBe(2);
      expect(entry.contentMarkdown!.length).toBeGreaterThan(3000);
    }
  });
});

describe('P5.4.1 Phase B runtime chain documents', () => {
  it('deepens API Server with the authenticated request pipeline and consistency semantics', () => {
    const entry = doc('k8s-apiserver');
    expect(entry.version).toBe(2);
    expect(entry.replacesContentHash).toBe(
      '81c6092c321002cfe808bdd6eff1d7c44a99a276e312d64bf82d96d1939c775b',
    );
    expect(entry.contentMarkdown!.length).toBeGreaterThan(3000);
    expect(entry.contentMarkdown).toContain('只有 kube-apiserver 配置了 etcd 端点并直接与 etcd 通信');
    expect(entry.contentMarkdown).toContain('API Priority and Fairness');
    expect(entry.contentMarkdown).toContain('resourceVersion=0');
    expect(entry.contentMarkdown).toContain('409 Conflict');
    expect(entry.contentMarkdown).toContain('它们都不直接访问 etcd');
  });

  it('deepens etcd with the Kubernetes-compatible version mapping and recovery steps', () => {
    const entry = doc('k8s-etcd');
    expect(entry.version).toBe(2);
    expect(entry.replacesContentHash).toBe(
      '933548092960c40af1fa0ec0f20da6130cb803d917fe12e5f1fc6e91ecf430bf',
    );
    expect(entry.contentMarkdown!.length).toBeGreaterThan(3000);
    expect(entry.contentMarkdown).toContain('kubeadm 1.34 默认安装 etcd 3.6.5');
    expect(entry.contentMarkdown).toContain('3.5.24');
    expect(entry.contentMarkdown).toContain('NOSPACE');
    expect(entry.contentMarkdown).toContain('etcdutl snapshot restore');
    expect(entry.contentMarkdown).toContain('只有 kube-apiserver 直接连接 etcd');
  });

  it('deepens kubelet with the 1.34 defaults and the node-side runtime boundary', () => {
    const entry = doc('k8s-kubelet');
    expect(entry.version).toBe(2);
    expect(entry.replacesContentHash).toBe(
      'b06009e6508d296ac938b86be03e81a1d3bd5b67249a0eaa838ae8bd6fa0dc36',
    );
    expect(entry.contentMarkdown!.length).toBeGreaterThan(3000);
    expect(entry.contentMarkdown).toContain('nodeStatusUpdateFrequency');
    expect(entry.contentMarkdown).toContain('nodeLeaseDurationSeconds');
    expect(entry.contentMarkdown).toContain('kubelet 不直接执行 CNI 插件');
    expect(entry.contentMarkdown).toContain('不直接访问 etcd');
    expect(entry.contentMarkdown).toContain('Kubernetes 1.34 默认值');
  });

  it('adds the CRI protocol document without duplicating the node', () => {
    const entry = doc('k8s-cri');
    expect(entry.version).toBe(2);
    expect(entry.replacesContentHash).toBeUndefined();
    expect(entry.contentMarkdown!.length).toBeGreaterThan(1500);
    expect(entry.contentMarkdown).toContain('RuntimeService');
    expect(entry.contentMarkdown).toContain('ImageService');
    expect(entry.contentMarkdown).toContain('RunPodSandbox');
    expect(entry.contentMarkdown).toContain('Kubernetes 1.26 及以后');
    expect(entry.contentMarkdown).toContain('CNI');
  });

  it('adds the versioned containerd 2.0 document with CRI plugin and shim architecture', () => {
    const entry = doc('k8s-containerd');
    expect(entry.version).toBe(2);
    expect(entry.replacesContentHash).toBeUndefined();
    expect(entry.contentMarkdown!.length).toBeGreaterThan(3000);
    expect(entry.contentMarkdown).toContain('io.containerd.cri.v1.runtime');
    expect(entry.contentMarkdown).toContain('io.containerd.cri.v1.images');
    expect(entry.contentMarkdown).toContain('SystemdCgroup');
    expect(entry.contentMarkdown).toContain('containerd 2.0');
    expect(entry.contentMarkdown).toContain('shim');
  });

  it('follows the fixed section order from the technical knowledge standard', () => {
    for (const nodeId of ['k8s-apiserver', 'k8s-etcd', 'k8s-kubelet', 'k8s-cri', 'k8s-containerd']) {
      const markdown = doc(nodeId).contentMarkdown!;
      const sections = ['技术定位', '设计原理', '工作机制', '关键配置与实践', '常见问题与限制', '技术关联', '参考资料'];
      const positions = sections.map((section) => markdown.indexOf(`## ${section}`));
      expect(positions.every((position) => position >= 0), `${nodeId} missing section`).toBe(true);
      expect(positions, `${nodeId} section order`).toEqual([...positions].sort((a, b) => a - b));
    }
  });
});
