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
    expect(entry.version).toBe(4);
    expect(entry.replacesContentHash).toBe(
      '9c646ec6ca0de6153bab9a7d50c99352ef367a1bd98c3bff19f1a399be973453',
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
    expect(entry.version).toBe(4);
    expect(entry.replacesContentHash).toBe(
      'eb83525ad578d6044ff382dbd07142dfaf595417c60d516188e0f53217646f0d',
    );
    expect(entry.contentMarkdown).toContain('被 selector 选中的端点');
    expect(entry.contentMarkdown).toContain('serving 且未 terminating');
    expect(entry.contentMarkdown).toContain('readinessGates');
    expect(entry.contentMarkdown).toContain('serving 且 terminating');
    expect(entry.contentMarkdown).toContain('EndpointSlice API reference');
  });

  it('documents event-driven requeue and QueueingHint version boundaries', () => {
    const entry = doc('k8s-scheduler');
    expect(entry.version).toBe(4);
    expect(entry.replacesContentHash).toBe(
      'b1bda716dbdbfacad309caac96833a6872839dfc44e7553c9bc4baf66e17e427',
    );
    expect(entry.contentMarkdown).toContain('重新入队与 QueueingHint');
    expect(entry.contentMarkdown).toContain('unschedulableQ');
    expect(entry.contentMarkdown).toContain('EnqueueExtension');
    expect(entry.contentMarkdown).toContain('1.29–1.31 默认关闭');
    expect(entry.contentMarkdown).toContain('不是调度周期的一个阶段');
  });

  it('keeps the reviewed Deployment sample at version 3 and Controller Manager at version 2', () => {
    expect(doc('k8s-deployment').version).toBe(3);
    expect(doc('k8s-controller-manager').version).toBe(2);
    for (const nodeId of ['k8s-deployment', 'k8s-controller-manager']) {
      const entry = doc(nodeId);
      expect(entry.contentMarkdown!.length).toBeGreaterThan(3000);
    }
  });
});

describe('P5.4.1 Phase B runtime chain documents', () => {
  it('deepens API Server with the authenticated request pipeline and consistency semantics', () => {
    const entry = doc('k8s-apiserver');
    expect(entry.version).toBe(3);
    expect(entry.replacesContentHash).toBe(
      '03c744af826696692600c39f92048e93e71a3c3a04809adb6922ec878615f619',
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
    expect(entry.version).toBe(3);
    expect(entry.replacesContentHash).toBe(
      '0d3afa829e0da7bd899e512510f5c4891655a5cbf4bb996116963ce184902e8c',
    );
    expect(entry.contentMarkdown!.length).toBeGreaterThan(3000);
    expect(entry.contentMarkdown).toContain('kubeadm 1.35、1.36、1.37 默认安装 etcd 3.6.6、3.6.8、3.7.0');
    expect(entry.contentMarkdown).toContain('3.5.24');
    expect(entry.contentMarkdown).toContain('NOSPACE');
    expect(entry.contentMarkdown).toContain('etcdutl snapshot restore');
    expect(entry.contentMarkdown).toContain('只有 kube-apiserver 直接连接 etcd');
  });

  it('deepens kubelet with the 1.34 defaults and the node-side runtime boundary', () => {
    const entry = doc('k8s-kubelet');
    expect(entry.version).toBe(3);
    expect(entry.replacesContentHash).toBe(
      '088b7eedc30f8ff1c0e50b87459ea2effe6e8fe7fbbd199b68d5b1d6c6fb701f',
    );
    expect(entry.contentMarkdown!.length).toBeGreaterThan(3000);
    expect(entry.contentMarkdown).toContain('nodeStatusUpdateFrequency');
    expect(entry.contentMarkdown).toContain('nodeLeaseDurationSeconds');
    expect(entry.contentMarkdown).toContain('kubelet 不直接执行 CNI 插件');
    expect(entry.contentMarkdown).toContain('不直接访问 etcd');
    expect(entry.contentMarkdown).toContain('Kubernetes 1.37 默认值');
  });

  it('adds the CRI protocol document without duplicating the node', () => {
    const entry = doc('k8s-cri');
    expect(entry.version).toBe(3);
    expect(entry.replacesContentHash).toBe(
      '00ad27a7a6934fdddea3b474d0e6a1990eecbcb7a7dcac50afa9ea06836e88df',
    );
    expect(entry.contentMarkdown!.length).toBeGreaterThan(1500);
    expect(entry.contentMarkdown).toContain('RuntimeService');
    expect(entry.contentMarkdown).toContain('ImageService');
    expect(entry.contentMarkdown).toContain('RunPodSandbox');
    expect(entry.contentMarkdown).toContain('Kubernetes 1.26 及以后');
    expect(entry.contentMarkdown).toContain('CNI');
  });

  it('adds the versioned containerd 2.0 document with CRI plugin and shim architecture', () => {
    const entry = doc('k8s-containerd');
    expect(entry.version).toBe(3);
    expect(entry.replacesContentHash).toBe(
      '0fe722ef8676333a29757c44181544839fb20c9bdebe9f36aab96aa97117e206',
    );
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

describe('P5.4.2 Kubernetes version governance', () => {
  const governed = [
    'k8s-apiserver',
    'k8s-pod',
    'k8s-scheduler',
    'k8s-kubelet',
    'k8s-etcd',
    'k8s-cri',
    'k8s-containerd',
    'k8s-service',
    'k8s-deployment',
  ];

  it('adds a version section between the config and limitation sections', () => {
    for (const nodeId of governed) {
      const markdown = doc(nodeId).contentMarkdown!;
      const versionSection = markdown.indexOf('## 版本差异与兼容性');
      expect(versionSection, `${nodeId} missing version section`).toBeGreaterThan(0);
      expect(versionSection, `${nodeId} version section position`).toBeGreaterThan(
        markdown.indexOf('## 关键配置与实践'),
      );
      expect(versionSection, `${nodeId} version section position`).toBeLessThan(
        markdown.indexOf('## 常见问题与限制'),
      );
    }
  });

  it('states a supported Kubernetes mainline and verification baseline', () => {
    for (const nodeId of governed.filter((id) => id !== 'k8s-containerd')) {
      const entry = doc(nodeId);
      expect(entry.applicableVersions, `${nodeId} applicableVersions`).toContain('Kubernetes 1.35–1.37');
      expect(entry.applicableVersions, `${nodeId} baseline`).toContain('1.37.2');
      expect(entry.contentMarkdown, `${nodeId} mainline`).toContain('1.35–1.37');
    }
  });

  it('governs containerd by its own release branches and the Kubernetes support matrix', () => {
    const entry = doc('k8s-containerd');
    expect(entry.applicableVersions).toContain('containerd 2.3 LTS');
    expect(entry.applicableVersions).toContain('2.4 Active');
    expect(entry.contentMarkdown).toContain('containerd 2.4.x 为核实基线');
    expect(entry.contentMarkdown).toContain('1.37 推荐 2.4.0+、2.3.0+');
  });

  it('does not leave every document on the old blanket version claim', () => {
    for (const nodeId of governed) {
      expect(doc(nodeId).applicableVersions).not.toBe('Kubernetes 1.28+（除单独标注外）');
    }
  });
});
