import React, { useState, useEffect } from 'react';
import { socket } from '../socket';
import axios from 'axios';

interface User {
    id: number;
    username: string;
    role: string;
    created_at: string;
}

interface PodStats {
    name: string;
    status: string;
    ready: boolean;
    ip: string;
    restarts: number;
}

const AdminPanel: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'users' | 'canvas' | 'infra' | 'database'>('infra');
    const [users, setUsers] = useState<User[]>([]);
    const [pods, setPods] = useState<PodStats[]>([]);
    const [dbPods, setDbPods] = useState<PodStats[]>([]);
    const [dbStats, setDbStats] = useState<Record<string, number>>({});
    const [vpaStats, setVpaStats] = useState<any>(null);

    // ... (in useEffect)
    useEffect(() => {
        if (isOpen) {
            fetchUsers();
            fetchPods();
            fetchDbPods();
        }
    }, [isOpen]);

    // Socket Listeners
    useEffect(() => {
        socket.on('admin:pod-update', (data: { event: string; pod: PodStats }) => {
            setPods(prev => {
                const exists = prev.find(p => p.name === data.pod.name);
                if (data.event === 'DELETED') {
                    return prev.filter(p => p.name !== data.pod.name);
                }
                if (exists) {
                    return prev.map(p => p.name === data.pod.name ? data.pod : p);
                }
                return [...prev, data.pod];
            });
        });

        socket.on('admin:db-update', (data: { event: string; pod: PodStats }) => {
            setDbPods(prev => {
                const exists = prev.find(p => p.name === data.pod.name);
                if (data.event === 'DELETED') {
                    return prev.filter(p => p.name !== data.pod.name);
                }
                if (exists) {
                    return prev.map(p => p.name === data.pod.name ? data.pod : p);
                }
                return [...prev, data.pod];
            });
        });

        socket.on('admin:db-stats', (stats: { shardId: number; count: number; podNameSuggestion: string }[]) => {
            setDbStats(prev => {
                const next = { ...prev };
                stats.forEach(s => {
                    next[s.podNameSuggestion] = s.count;
                });
                return next;
            });
        });

        socket.on('admin:notification', (data: { message: string; type: 'info' | 'error' }) => {
            setNotification(data);
            setTimeout(() => setNotification(null), 5000);
        });

        // Real-time User Updates
        socket.on('admin:user-joined', (newUser: any) => {
            setUsers(prev => {
                if (prev.find(u => (u as any).socketId === newUser.socketId)) return prev;
                return [newUser, ...prev];
            });
        });

        socket.on('admin:hpa-update', (stats: any) => {
            setHpaStats(stats);
        });

        socket.on('admin:user-left', (data: { socketId: string, id: number }) => {
            setUsers(prev => prev.filter(u => (u as any).socketId !== data.socketId));
        });

        return () => {
            socket.off('admin:pod-update');
            socket.off('admin:db-update');
            socket.off('admin:db-stats');
            socket.off('admin:notification');
            socket.off('admin:user-joined');
            socket.off('admin:user-left');
            socket.off('admin:hpa-update');
            socket.off('admin:vpa-update');
        };
    }, []);

    useEffect(() => {
        socket.on('admin:vpa-update', (stats) => setVpaStats(stats));
        return () => { socket.off('admin:vpa-update'); };
    }, []);

    const fetchUsers = async () => {
        try {
            const res = await axios.get('/api/admin/users', {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            setUsers(res.data);
        } catch (err) {
            console.error("Failed to fetch users", err);
        }
    };

    const fetchPods = async () => {
        try {
            const res = await axios.get('/api/admin/monitor', {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            setPods(res.data);
        } catch (err) {
            console.error("Failed to fetch pods", err);
        }
    };

    const fetchDbPods = async () => {
        try {
            const res = await axios.get('/api/admin/monitor/db', {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            setDbPods(res.data);
        } catch (err) {
            console.error("Failed to fetch DB pods", err);
        }
    };

    const [notification, setNotification] = useState<{ message: string; type: 'info' | 'error' } | null>(null);
    const [hpaStats, setHpaStats] = useState<{
        currentReplicas: number;
        desiredReplicas: number;
        minReplicas: number;
        maxReplicas: number;
        currentCpu: number;
        targetCpu: number;
    } | null>(null);

    // ... (rest of useEffects/listeners are fine)

    const handleBan = async (id: number) => {
        if (!confirm("Ban this user?")) return;
        try {
            await axios.post(`/api/admin/users/${id}/ban`, {}, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            fetchUsers();
        } catch (err) {
            alert("Failed to ban user");
        }
    };

    const handleClearCanvas = async () => {
        if (!confirm("ARE YOU SURE? This will wipe the database.")) return;
        try {
            await axios.post('/api/admin/canvas/clear', {}, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            alert("Canvas cleared");
        } catch (err) {
            alert("Failed to clear canvas");
        }
    };

    return (
        // ... (Toggle/Toast) 
        <>
            {/* Toggle Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    position: 'fixed',
                    right: 0,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    zIndex: 9999,
                    padding: '10px',
                    background: '#333',
                    color: 'white',
                    border: 'none',
                    borderTopLeftRadius: '5px',
                    borderBottomLeftRadius: '5px',
                    cursor: 'pointer'
                }}
            >
                {isOpen ? 'Close' : 'Admin'}
            </button>

            {/* Notification Toast */}
            {notification && (
                <div style={{
                    position: 'fixed',
                    top: '20px',
                    right: '50%',
                    transform: 'translateX(50%)',
                    background: notification.type === 'error' ? 'red' : 'green',
                    color: 'white',
                    padding: '10px 20px',
                    borderRadius: '5px',
                    zIndex: 10000,
                    fontWeight: 'bold'
                }}>
                    {notification.message}
                </div>
            )}

            {/* Panel */}
            {isOpen && (
                <div style={{
                    position: 'fixed',
                    right: 0,
                    top: 0,
                    height: '100vh',
                    width: '350px',
                    background: 'rgba(0, 0, 0, 0.9)',
                    color: 'white',
                    zIndex: 9998,
                    padding: '20px',
                    boxShadow: '-2px 0 5px rgba(0,0,0,0.5)',
                    overflowY: 'auto'
                }}>
                    <h2>Admin Panel</h2>
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid #555' }}>
                        <button onClick={() => setActiveTab('infra')} style={{ background: 'none', border: 'none', color: activeTab === 'infra' ? '#fff' : '#888', cursor: 'pointer', padding: '10px', fontWeight: 'bold', borderBottom: activeTab === 'infra' ? '2px solid white' : 'none' }}>Infra</button>
                        <button onClick={() => setActiveTab('database')} style={{ background: 'none', border: 'none', color: activeTab === 'database' ? '#fff' : '#888', cursor: 'pointer', padding: '10px', fontWeight: 'bold', borderBottom: activeTab === 'database' ? '2px solid white' : 'none' }}>Database</button>
                        <button onClick={() => setActiveTab('users')} style={{ background: 'none', border: 'none', color: activeTab === 'users' ? '#fff' : '#888', cursor: 'pointer', padding: '10px', fontWeight: 'bold', borderBottom: activeTab === 'users' ? '2px solid white' : 'none' }}>Users</button>
                        <button onClick={() => setActiveTab('canvas')} style={{ background: 'none', border: 'none', color: activeTab === 'canvas' ? '#fff' : '#888', cursor: 'pointer', padding: '10px', fontWeight: 'bold', borderBottom: activeTab === 'canvas' ? '2px solid white' : 'none' }}>Canvas</button>
                    </div>

                    {activeTab === 'infra' && (
                        <div>
                            <h3>App Cluster</h3>
                            {/* HPA Stats */}
                            {hpaStats && (
                                <div style={{ marginBottom: '20px', padding: '15px', background: '#222', borderRadius: '8px' }}>
                                    <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#ccc' }}>Autoscaling Status (CPU)</h4>

                                    {/* Progress Bar Container */}
                                    <div style={{ width: '100%', height: '20px', background: '#444', borderRadius: '10px', overflow: 'hidden', position: 'relative' }}>
                                        {/* Fill */}
                                        <div style={{
                                            width: `${Math.min((hpaStats.currentCpu / hpaStats.targetCpu) * 100, 100)}%`, // Scale relative to target
                                            height: '100%',
                                            background: hpaStats.currentCpu >= hpaStats.targetCpu ? '#ef4444' : '#22c55e',
                                            transition: 'width 0.5s ease-in-out, background 0.5s'
                                        }} />

                                        {/* Text Overlay */}
                                        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 'bold', textShadow: '0 1px 2px black' }}>
                                            {hpaStats.currentCpu}% / {hpaStats.targetCpu}%
                                        </div>
                                    </div>

                                    <div style={{ marginTop: '10px', fontSize: '12px', display: 'flex', justifyContent: 'space-between', color: '#888' }}>
                                        <span>Replicas: <strong style={{ color: 'white' }}>{hpaStats.currentReplicas}</strong> / {hpaStats.maxReplicas}</span>
                                        <span>Status: {hpaStats.currentReplicas >= hpaStats.maxReplicas ? 'Fully Scaled (Max)' : hpaStats.currentCpu > hpaStats.targetCpu ? 'Scaling Up...' : 'Healthy'}</span>
                                    </div>
                                </div>
                            )}

                            <button onClick={fetchPods} style={{ marginBottom: '10px', padding: '5px 10px', fontSize: '12px', cursor: 'pointer' }}>Refresh Pods</button>
                            {pods.length === 0 ? <p>No pods found or loading...</p> : (
                                <ul style={{ listStyle: 'none', padding: 0 }}>
                                    {pods.map(pod => (
                                        <li key={pod.name} style={{
                                            padding: '10px',
                                            marginBottom: '5px',
                                            background: pod.status === 'Running' ? '#1a1a1a' : '#300',
                                            borderLeft: `4px solid ${pod.ready ? 'green' : 'red'}`
                                        }}>
                                            <strong>{pod.name}</strong><br />
                                            Status: {pod.status}<br />
                                            IP: {pod.ip}<br />
                                            Restarts: {pod.restarts}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}





                    {activeTab === 'database' && (
                        <div>
                            <h3>Database Shards</h3>

                            {vpaStats && (
                                <div style={{ marginBottom: '20px', padding: '15px', background: '#1c1c1c', borderRadius: '8px', borderLeft: '4px solid #8b5cf6', fontFamily: 'monospace' }}>
                                    <h4 style={{ margin: '0 0 15px 0', fontSize: '14px', color: '#c4b5fd' }}>Vertical Autoscaling (VPA) Status</h4>

                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                                        <thead>
                                            <tr style={{ color: '#888', borderBottom: '1px solid #333' }}>
                                                <th style={{ textAlign: 'left', padding: '5px' }}>Metric</th>
                                                <th style={{ textAlign: 'left', padding: '5px' }}>Current</th>
                                                <th style={{ textAlign: 'left', padding: '5px' }}>Target (VPA)</th>
                                                <th style={{ textAlign: 'left', padding: '5px', color: '#666' }}>Min / Max</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr>
                                                <td style={{ padding: '8px 5px', color: '#ddd' }}>CPU</td>
                                                <td style={{ padding: '8px 5px' }}>
                                                    {vpaStats.current?.cpu === 'N/A' ?
                                                        <span style={{ color: '#f59e0b', fontSize: '11px' }}>⚠ Unset (Restart to Apply)</span> :
                                                        vpaStats.current?.cpu}
                                                </td>
                                                <td style={{ padding: '8px 5px', color: '#a78bfa', fontWeight: 'bold' }}>{vpaStats.target?.cpu || 'Pending...'}</td>
                                                <td style={{ padding: '8px 5px', color: '#666' }}>{vpaStats.minAllowed?.cpu} / {vpaStats.maxAllowed?.cpu}</td>
                                            </tr>
                                            <tr>
                                                <td style={{ padding: '8px 5px', color: '#ddd' }}>Memory</td>
                                                <td style={{ padding: '8px 5px' }}>
                                                    {vpaStats.current?.memory === 'N/A' ?
                                                        <span style={{ color: '#f59e0b', fontSize: '11px' }}>⚠ Restart to Apply</span> :
                                                        vpaStats.current?.memory}
                                                </td>
                                                <td style={{ padding: '8px 5px', color: '#a78bfa', fontWeight: 'bold' }}>{vpaStats.target?.memory || 'Pending...'}</td>
                                                <td style={{ padding: '8px 5px', color: '#666' }}>{vpaStats.minAllowed?.memory} / {vpaStats.maxAllowed?.memory}</td>
                                            </tr>
                                        </tbody>
                                    </table>

                                    <div style={{ marginTop: '15px', fontSize: '11px', color: '#666', display: 'flex', gap: '15px' }}>
                                        <div>Mode: <strong style={{ color: '#ccc' }}>Initial</strong></div>
                                        <div>Uncapped Est: {vpaStats.uncappedTarget?.cpu || '-'} / {vpaStats.uncappedTarget?.memory || '-'}</div>
                                    </div>
                                </div>
                            )}

                            <button onClick={fetchDbPods} style={{ marginBottom: '10px', padding: '5px 10px', fontSize: '12px', cursor: 'pointer' }}>Refresh DB</button>
                            {dbPods.length === 0 ? <p>No DB pods found.</p> : (
                                <ul style={{ listStyle: 'none', padding: 0 }}>
                                    {dbPods.map(pod => (
                                        <li key={pod.name} style={{
                                            padding: '10px',
                                            marginBottom: '5px',
                                            background: pod.status === 'Running' ? '#1a1a1a' : '#520000',
                                            borderLeft: `4px solid ${pod.ready ? 'blue' : 'orange'}`
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div>
                                                    <div style={{ fontWeight: 'bold', color: '#aaf' }}>{pod.name}</div>
                                                    <div style={{ fontSize: '0.9em' }}>Status: {pod.status}</div>
                                                    <div style={{ fontSize: '0.9em' }}>IP: {pod.ip}</div>
                                                    <div style={{ fontSize: '0.9em' }}>Restarts: {pod.restarts}</div>
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'white' }}>
                                                        {dbStats[pod.name] !== undefined ? dbStats[pod.name].toLocaleString() : '-'}
                                                    </div>
                                                    <div style={{ fontSize: '10px', color: '#888' }}>STROKES</div>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}

                    {activeTab === 'users' && (
                        <div>
                            <h3>Live Users (Real-time)</h3>
                            <button onClick={fetchUsers} style={{ marginBottom: '10px' }}>Refresh</button>
                            <ul style={{ listStyle: 'none', padding: 0 }}>
                                {users.map((u: any, idx) => (
                                    <li key={`${u.id}-${idx}`} style={{ padding: '10px', marginBottom: '5px', background: '#222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span>
                                            <span style={{ color: u.role === 'admin' ? 'gold' : 'white' }}>● </span>
                                            {u.username} <small style={{ color: '#888' }}>({u.role})</small>
                                        </span>
                                        {u.role !== 'admin' && (
                                            <button onClick={() => handleBan(u.id)} style={{ background: 'red', color: 'white', border: 'none', padding: '5px', cursor: 'pointer' }}>Ban</button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {activeTab === 'canvas' && (
                        <div style={{ textAlign: 'center', marginTop: '50px' }}>
                            <h3>Danger Zone</h3>
                            <p>This action is irreversible.</p>
                            <button
                                onClick={handleClearCanvas}
                                style={{
                                    background: 'red',
                                    color: 'white',
                                    border: 'none',
                                    padding: '20px',
                                    fontSize: '18px',
                                    cursor: 'pointer',
                                    borderRadius: '5px'
                                }}
                            >
                                CLEAR ENTIRE CANVAS
                            </button>
                        </div>
                    )}
                </div>
            )}
        </>
    );
};

export default AdminPanel;
