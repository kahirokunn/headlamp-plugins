import { KubeObject, type KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import type { Condition } from './common';

type Traffic = {
  latestRevision: boolean;
  percent: number;
  revisionName: string;
  configurationName?: string;
  tag?: string;
  url?: string;
};

export interface KServiceResource extends KubeObjectInterface {
  spec: {
    traffic?: Traffic[];
    template: {
      metadata?: {
        annotations?: Record<string, string>;
        labels?: Record<string, string>;
        finalizers?: string[];
        name?: string;
        namespace?: string;
      };
      spec: {
        containerConcurrency?: number;
        containers: Array<{
          name?: string;
          image: string;
          args?: string[];
          command?: string[];
          env?: Array<{
            name: string;
            value?: string;
          }>;
          envFrom?: Array<{
            configMapRef?: { name?: string; optional?: boolean };
            secretRef?: { name?: string; optional?: boolean };
            prefix?: string;
          }>;
          imagePullPolicy?: string;
          ports: Array<{
            containerPort: number;
            name?: string;
            protocol?: string;
          }>;
          resources?: {
            limits?: Record<string, string>;
            requests?: Record<string, string>;
          };
        }>;
        imagePullSecrets?: Array<{ name?: string }>;
        serviceAccountName?: string;
        timeoutSeconds?: number;
        idleTimeoutSeconds?: number;
        responseStartTimeoutSeconds?: number;
      };
    };
  };
  status?: {
    url?: string;
    address?: {
      url?: string;
      name?: string;
      audience?: string;
      CACerts?: string;
    };
    annotations?: Record<string, string>;
    latestCreatedRevisionName?: string;
    latestReadyRevisionName?: string;
    observedGeneration?: number;
    conditions?: Condition[];
    traffic?: Traffic[];
  };
}

export class KService extends KubeObject<KServiceResource> {
  static kind = 'Service';
  static apiName = 'services';
  static apiVersion = 'serving.knative.dev/v1';
  static isNamespaced = true;

  static getBaseObject(): KServiceResource {
    const baseObject = super.getBaseObject() as KServiceResource;

    baseObject.spec = {
      traffic: [],
      template: {
        metadata: {
          annotations: {
            'autoscaling.knative.dev/min-scale': '0',
          },
          labels: {},
        },
        spec: {
          containerConcurrency: 0,
          containers: [
            {
              name: '',
              image: '',
              args: [],
              command: [],
              env: [],
              envFrom: [],
              imagePullPolicy: 'IfNotPresent',
              ports: [
                {
                  containerPort: 8080,
                  name: 'app',
                  protocol: 'http1',
                },
              ],
              resources: {
                limits: {
                  cpu: '2',
                  memory: '4Gi',
                },
                requests: {
                  cpu: '2',
                  memory: '4Gi',
                },
              },
            },
          ],
          imagePullSecrets: [
            {
              name: '',
            },
          ],
          serviceAccountName: '',
          timeoutSeconds: 0,
          idleTimeoutSeconds: 0,
          responseStartTimeoutSeconds: 0,
        },
      },
    };

    return baseObject;
  }

  get metadata() {
    return this.jsonData.metadata;
  }

  get spec() {
    return this.jsonData.spec;
  }

  get status() {
    return this.jsonData.status;
  }

  get url(): string | undefined {
    return this.status?.url || this.status?.address?.url;
  }

  get isReady(): boolean {
    return this.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True';
  }
}
