/*
 * Minimal TypeScript types for Knative Service and Revision (serving.knative.dev/v1).
 */

interface ObjectMeta {
  name: string;
  namespace?: string;
  uid?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  creationTimestamp?: string;
}

interface Condition {
  type: string;
  status: 'True' | 'False' | 'Unknown' | string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface TrafficTarget {
  percent?: number;
  tag?: string;
  latestRevision?: boolean;
  revisionName?: string;
}

interface KnativeServiceSpec {
  traffic?: TrafficTarget[];
  template?: {
    metadata?: {
      annotations?: Record<string, string>;
      labels?: Record<string, string>;
    };
    spec?: Record<string, unknown>;
  };
}

interface KnativeServiceStatus {
  url?: string;
  address?: {
    url?: string;
  };
  latestReadyRevisionName?: string;
  conditions?: Condition[];
  traffic?: (TrafficTarget & { url?: string })[];
}

export interface KnativeService {
  apiVersion: 'serving.knative.dev/v1';
  kind: 'Service';
  metadata: ObjectMeta;
  spec: KnativeServiceSpec;
  status?: KnativeServiceStatus;
}

export interface KnativeRevision {
  apiVersion: 'serving.knative.dev/v1';
  kind: 'Revision';
  metadata: ObjectMeta;
  spec?: Record<string, unknown>;
  status?: {
    conditions?: Condition[];
  };
}

export interface K8sList<T> {
  apiVersion: string;
  kind: string;
  items: T[];
}
