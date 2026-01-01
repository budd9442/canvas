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
    const [activeTab, setActiveTab] = useState<'users' | 'canvas' | 'infra'>('infra');
    const [users, setUsers] = useState<User[]>([]);
    const [pods, setPods] = useState<PodStats[]>([]);
    const [notification, setNotification] = useState<{ message: string; type: 'info' | 'error' } | null>(null);
    const [hpaStats, setHpaStats] = useState<{
        currentReplicas: number;
        desiredReplicas: number;
        minReplicas: number;
        maxReplicas: number;
        currentCpu: number;
        targetCpu: number;
    } | null>(null);

    // Initial Data Fetch
    useEffect(() => {
        if (isOpen) {
            fetchUsers();
            fetchPods();
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

        socket.on('admin:notification', (data: { message: string; type: 'info' | 'error' }) => {
            setNotification(data);
            setTimeout(() => setNotification(null), 5000);
        });

        // Real-time User Updates
        socket.on('admin:user-joined', (newUser: any) => {
            // Check if user already in list (e.g. multiple tabs)
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
            socket.off('admin:notification');
            socket.off('admin:user-joined');
            socket.off('admin:user-left');
            socket.off('admin:hpa-update');
        };
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
                        <button onClick={() => setActiveTab('infra')} style={{ background: 'none', border: 'none', color: activeTab === 'infra' ? '#fff' : '#888', cursor: 'pointer', padding: '10px', fontWeight: 'bold' }}>Infra</button>
                        <button onClick={() => setActiveTab('users')} style={{ background: 'none', border: 'none', color: activeTab === 'users' ? '#fff' : '#888', cursor: 'pointer', padding: '10px', fontWeight: 'bold' }}>Users</button>
                        <button onClick={() => setActiveTab('canvas')} style={{ background: 'none', border: 'none', color: activeTab === 'canvas' ? '#fff' : '#888', cursor: 'pointer', padding: '10px', fontWeight: 'bold' }}>Canvas</button>
                    </div>

                    {activeTab === 'infra' && (
                        <div>
                            <h3>Kubernetes Monitor</h3>

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
