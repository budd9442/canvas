import { KubeConfig, CoreV1Api, Watch, AutoscalingV2Api } from '@kubernetes/client-node';
import { Server } from 'socket.io';

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

        // Poll every 5 seconds
        setInterval(pollHPA, 5000);
        pollHPA(); // Immediate call

    } catch (err) {
        console.error("Failed to initialize K8s Monitor:", err);
    }
};

export const getPodStats = async () => {
    try {
        const kc = new KubeConfig();
        kc.loadFromDefault();
        const k8sApi = kc.makeApiClient(CoreV1Api);

        // Filter by label
        const res = await k8sApi.listNamespacedPod('default', undefined, undefined, undefined, undefined, 'app=paint-backend');

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
