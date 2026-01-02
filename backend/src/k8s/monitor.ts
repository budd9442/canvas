import { KubeConfig, CoreV1Api, Watch, AutoscalingV2Api, CustomObjectsApi } from '@kubernetes/client-node';
import { Server } from 'socket.io';
import { getShardCounts } from '../db';

export const setupMonitor = (io: Server) => {
    try {
        const kc = new KubeConfig();
        kc.loadFromDefault();

        const k8sApi = kc.makeApiClient(CoreV1Api);
        const hpaApi = kc.makeApiClient(AutoscalingV2Api);
        const watch = new Watch(kc);

        console.log("Starting K8s Monitor...");

        // 1. Pod Watcher (Existing)
        watch.watch(
            '/api/v1/namespaces/default/pods',
            { labelSelector: 'app=paint-backend' },
            (phase, apiObj, watchObj) => {
                if (phase === 'ADDED' || phase === 'MODIFIED' || phase === 'DELETED') {
                    const podName = apiObj.metadata.name;
                    const status = apiObj.status.phase;
                    const ready = apiObj.status.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True';

                    // Emit update to admin room
                    io.to('admin').emit('admin:pod-update', {
                        event: phase,
                        pod: {
                            name: podName,
                            status: status,
                            ready: ready,
                            ip: apiObj.status.podIP,
                            restarts: apiObj.status.containerStatuses?.[0]?.restartCount || 0
                        }
                    });

                    if (phase === 'DELETED' || status === 'Failed' || (status === 'Pending' && !ready)) {
                        // Only alert on abnormal failures, not normal scaling termination
                        if (status === 'Failed') {
                            io.to('admin').emit('admin:notification', {
                                type: 'error',
                                message: `Pod Alert: ${podName} is ${status}`,
                                timestamp: Date.now()
                            });
                        }
                    }
                }
            },
            (err) => { console.error("K8s Watch Error:", err); }
        );

        // 2. Database Watcher (New)
        watch.watch(
            '/api/v1/namespaces/default/pods',
            { labelSelector: 'app=postgres' },
            (phase, apiObj, watchObj) => {
                if (phase === 'ADDED' || phase === 'MODIFIED' || phase === 'DELETED') {
                    const podName = apiObj.metadata.name;
                    const status = apiObj.status.phase;
                    const ready = apiObj.status.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True';

                    // Emit update to admin room
                    io.to('admin').emit('admin:db-update', {
                        event: phase,
                        pod: {
                            name: podName,
                            status: status,
                            ready: ready,
                            ip: apiObj.status.podIP,
                            restarts: apiObj.status.containerStatuses?.[0]?.restartCount || 0
                        }
                    });

                    // Alerting for DB
                    if (phase === 'DELETED' || status === 'Failed' || (status === 'Pending' && !ready)) {
                        if (status === 'Failed') {
                            io.to('admin').emit('admin:notification', {
                                type: 'error',
                                message: `DB Alert: ${podName} is ${status}`,
                                timestamp: Date.now()
                            });
                        }
                    }
                }
            },
            (err) => { console.error("K8s DB Watch Error:", err); }
        );

        // 2. HPA Poller (New)
        const pollHPA = async () => {
            try {
                const res = await hpaApi.readNamespacedHorizontalPodAutoscaler('paint-backend', 'default');
                const hpa = res.body;

                if (hpa && hpa.status) {
                    // Extract CPU Metric Status
                    const cpuMetric = hpa.status.currentMetrics?.find(m => m.type === 'Resource' && m.resource?.name === 'cpu');
                    const currentCpu = cpuMetric?.resource?.current?.averageUtilization || 0;

                    // Target is in spec
                    const cpuTarget = hpa.spec?.metrics?.find(m => m.type === 'Resource' && m.resource?.name === 'cpu');
                    const targetCpu = cpuTarget?.resource?.target?.averageUtilization || 75; // Default from our config

                    const stats = {
                        currentReplicas: hpa.status.currentReplicas,
                        desiredReplicas: hpa.status.desiredReplicas,
                        minReplicas: hpa.spec?.minReplicas,
                        maxReplicas: hpa.spec?.maxReplicas,
                        currentCpu,
                        targetCpu
                    };

                    io.to('admin').emit('admin:hpa-update', stats);
                }
            } catch (err) {
                // HPA might not exist or permissions error
                // console.error("HPA Poll Error (ignorable):", err);
            }
        };

        // 3. Shard Stats Poller (New)
        const pollShardStats = async () => {
            try {
                const stats = await getShardCounts();
                io.to('admin').emit('admin:db-stats', stats);
            } catch (err) {
                console.error("Shard Stats Poll Error:", err);
            }
        };

        const customApi = kc.makeApiClient(CustomObjectsApi);

        // ... (Watchers hidden for brevity)

        // 3. VPA Poller (New)
        const pollVPA = async () => {
            try {
                const res = await customApi.getNamespacedCustomObject(
                    'autoscaling.k8s.io',
                    'v1',
                    'default',
                    'verticalpodautoscalers',
                    'postgres-vpa'
                );

                const vpa = res.body as any;

                // Fetch current pod usage/requests to compare
                const pods = await k8sApi.listNamespacedPod('default', undefined, undefined, undefined, undefined, 'app=postgres');
                const currentRequest = pods.body.items[0]?.spec?.containers.find(c => c.name === 'postgres')?.resources?.requests || { cpu: 'N/A', memory: 'N/A' };

                if (vpa) { // Even if no reco yet, send config
                    const recommendations = vpa.status?.recommendation?.containerRecommendations?.[0] || {};
                    const policy = vpa.spec?.resourcePolicy?.containerPolicies?.[0] || {};

                    io.to('admin').emit('admin:vpa-update', {
                        current: currentRequest,
                        target: recommendations.target || {},
                        uncappedTarget: recommendations.uncappedTarget || {},
                        minAllowed: policy.minAllowed || {},
                        maxAllowed: policy.maxAllowed || {}
                    });
                }
            } catch (err) {
                // VPA might not exist yet
            }
        };

        // Poll every 5 seconds
        setInterval(() => {
            pollHPA();
            pollShardStats();
            pollVPA();
        }, 5000);
        pollHPA();
        pollShardStats();
        pollVPA();

    } catch (err) {
        console.error("Failed to initialize K8s Monitor:", err);
    }
};

export const getPodStats = async (label = 'app=paint-backend') => {
    try {
        const kc = new KubeConfig();
        kc.loadFromDefault();
        const k8sApi = kc.makeApiClient(CoreV1Api);

        // Filter by label
        const res = await k8sApi.listNamespacedPod('default', undefined, undefined, undefined, undefined, label);

        return res.body.items.map(pod => ({
            name: pod.metadata?.name,
            status: pod.status?.phase,
            ready: pod.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True',
            ip: pod.status?.podIP,
            restarts: pod.status?.containerStatuses?.[0]?.restartCount || 0
        }));
    } catch (err) {
        console.error("Get Pod Stats Error:", err);
        return [];
    }
};
