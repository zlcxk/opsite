import type { SourceType, VersionRange } from '../../shared/types.js';

export interface RawLifecycle {
  cycle: string;
  releaseDate: string | null;
  latestVersion: string | null;
  latestReleaseDate: string | null;
  eolDate: string | null;
  supportStatus: 'supported' | 'approaching_eol' | 'eol' | 'unknown';
  sourceUrl: string;
  raw: unknown;
}

export interface RawRelease {
  externalId: string;
  version: string;
  channel: 'stable' | 'prerelease';
  title: string | null;
  notes: string | null;
  url: string | null;
  publishedAt: string | null;
  raw: unknown;
}

export interface RawAdvisory {
  identifier: string;
  externalId: string;
  title: string;
  description: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  score: number | null;
  scoreSource: string | null;
  url: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  kev: boolean;
  kevDueDate: string | null;
  affectedRanges: VersionRange[];
  fixedVersions: string[];
  confidence: 'high' | 'medium' | 'low';
  sourceType: SourceType;
  raw: unknown;
}

export interface AdapterContext {
  sourceId: string;
  softwareId: string;
  config: Record<string, string>;
}

export interface AdapterResult {
  lifecycle?: RawLifecycle[];
  releases?: RawRelease[];
  advisories?: RawAdvisory[];
  itemCount: number;
  note?: string;
  /** True only when the upstream payload differed from what was already stored. */
  dataChanged?: boolean;
}
