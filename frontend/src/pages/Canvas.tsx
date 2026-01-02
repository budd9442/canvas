import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCanvas } from '../hooks/useCanvas';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'react-toastify';
import { motion, AnimatePresence } from 'framer-motion';
import {
    MousePointer2,
    Pencil,
    Trash2,
    LogOut,
    Brush,
    Highlighter,
    PenTool,
    MoreHorizontal,
    Home,
    ChevronLeft,
    Sparkles,
    Palette,
    Eraser,
    RefreshCw
} from 'lucide-react';
import { socket } from '../socket';
import Lanyard from '../components/Lanyard';
import { api } from '../services/api';

// Types
type BrushType = 'pencil' | 'pen' | 'marker' | 'highlighter' | 'galaxy';

interface BrushConfig {
    size: number;
    opacity: number;
    color: string;
    icon: any;
    label: string;
}

const DEFAULT_PRESETS: Record<BrushType, BrushConfig> = {
    pencil: { size: 2, opacity: 1, icon: Pencil, label: 'Pencil', color: '#000000' },
    pen: { size: 4, opacity: 1, icon: PenTool, label: 'Pen', color: '#1d4ed8' },
    marker: { size: 10, opacity: 1, icon: Brush, label: 'Marker', color: '#ef4444' },
    highlighter: { size: 20, opacity: 0.3, icon: Highlighter, label: 'Highlighter', color: '#facc15' },
    galaxy: { size: 6, opacity: 1, icon: Sparkles, label: 'Galaxy', color: 'rainbow' },
};

// Standard Colors for Picker
const COLOR_PALETTE = [
    '#000000', '#ffffff', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7'
];

const Canvas: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { user, logout } = useAuth();

    // Canvas Config
    const canvasId = id || 'default';

    // State: Tools
    type Mode = 'draw' | 'select' | 'erase';
    const [mode, setMode] = useState<Mode>('draw');

    // State: Ban
    // @ts-ignore
    const [isBanned, setIsBanned] = useState(false);
    // @ts-ignore
    const [banMessage, setBanMessage] = useState("");

    // Socket Notifications
    useEffect(() => {
        const onConnect = () => toast.success("Connected to server", { toastId: 'connection-status' });
        const onDisconnect = (reason: string) => {
            if (reason === 'io server disconnect') {
                // Explicit disconnection by server (likely ban or kick)
                setIsBanned(true);
                setBanMessage("Your connection was closed by the server.");
                toast.error("Disconnected by server.", { toastId: 'connection-status' });
            } else {
                toast.warn("Disconnected — attempting reconnect...", { toastId: 'connection-status' });
            }
        };

        const onBanned = (data: { message: string }) => {
            console.log("Received Ban Event:", data);
            setIsBanned(true);
            setBanMessage(data.message);
            setMode('select'); // Disable drawing
            socket.disconnect(); // Ensure disconnect implies no retry loop from this side if needed, but 'disconnect' from server usually handles it.
        };

        const onError = (err: any) => {
            // Use specific ID for Redis/System errors to prevent stacking
            const id = err.code === 'REDIS_DOWN' || err.code === 'REDIS_ERROR' ? 'redis-error' : undefined;
            toast.error(`Error: ${err.message || 'Unknown error'}`, { toastId: id });
        };

        const onSuccess = (data: any) => {
            if (data.code === 'REDIS_UP') {
                toast.dismiss('redis-error'); // Clear the error toast
                toast.success(data.message, { toastId: 'redis-success' });
            }
        };

        const onConnectError = (err: any) => {
            console.error("Connection Error:", err);

            const msg = err.message || "";

            // Check for Ban
            if (msg.toLowerCase().includes('banned') || msg.includes('User not found')) {
                setIsBanned(true);
                setBanMessage("Account suspended or not found.");
                socket.disconnect(); // Stop retrying
            } else {
                // Only show toast if not just polling error to avoid spam
                if (msg !== 'xhr poll error') {
                    toast.error(`Connection failed: ${msg}`, { toastId: 'connection-error' });
                }
            }
        };

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('banned', onBanned);
        socket.on('error', onError);
        socket.on('success', onSuccess); // Listen for custom success events
        socket.on('connect_error', onConnectError);

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('banned', onBanned);
            socket.off('error', onError);
            socket.off('success', onSuccess);
            socket.off('connect_error', onConnectError);
        };
    }, []);
    const [activeBrush, setActiveBrush] = useState<BrushType>('pen');
    const [eraserSize, setEraserSize] = useState(20);

    // State: Brush Configs (Mutable per tool)
    const [brushConfigs, setBrushConfigs] = useState<Record<BrushType, BrushConfig>>(DEFAULT_PRESETS);

    // State: UI
    const [showColorPicker, setShowColorPicker] = useState(false);

    // Derived current attributes
    const currentConfig = brushConfigs[activeBrush];

    // Fabric Hook
    const isEditor = user ? true : false;
    const { canvasRef, lastAck } = useCanvas(
        canvasId,
        mode,
        currentConfig.color,
        mode === 'erase' ? eraserSize : currentConfig.size,
        currentConfig.opacity,
        isEditor
    );

    // Handlers
    const selectBrush = (type: BrushType) => {
        if (mode === 'draw' && activeBrush === type) {
            // Second click -> Toggle properties/color
            setShowColorPicker(!showColorPicker);
        } else {
            setMode('draw');
            setActiveBrush(type);
            setShowColorPicker(false);
        }
    };

    const toggleEraser = () => {
        if (mode === 'erase') {
            // Second click -> Toggle Size Slider (reusing picker state)
            setShowColorPicker(!showColorPicker);
        } else {
            setMode('erase');
            setShowColorPicker(false);
        }
    };

    const activateSelect = () => {
        setMode('select');
        setShowColorPicker(false);
    };

    const updateBrushColor = (newColor: string) => {
        setBrushConfigs(prev => ({
            ...prev,
            [activeBrush]: { ...prev[activeBrush], color: newColor }
        }));
        // Don't close picker immediately to allow tweaking
    };

    const isAdmin = user?.role === 'admin';

    // Stats State
    // @ts-ignore
    const [strokeCount, setStrokeCount] = useState<number | null>(null);

    const fetchStats = async () => {
        try {
            const res = await api.get(`/canvas/${canvasId}/stats`);
            setStrokeCount(res.data.strokeCount);
        } catch (err) {
            console.error(err);
        }
    };

    // Poll stats every 5 seconds
    useEffect(() => {
        fetchStats();
        const interval = setInterval(fetchStats, 5000);
        return () => clearInterval(interval);
    }, [canvasId]);

    const handleClear = () => {
        if (isAdmin) socket.emit('clear_canvas', canvasId);
    };

    const handleLogout = () => {
        if (logout) logout();
        navigate('/login');
    };

    return (
        <div className="flex flex-col h-screen w-full bg-background relative overflow-hidden">

            {/* Banned Overlay */}
            {isBanned && (
                <div className="absolute inset-0 z-[100] bg-red-900/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="bg-zinc-900 border border-red-500/50 p-8 rounded-2xl shadow-2xl max-w-md w-full text-center space-y-6"
                    >
                        <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
                            <LogOut size={40} className="text-red-500" />
                        </div>

                        <div className="space-y-2">
                            <h2 className="text-3xl font-bold text-white">Access Revoked</h2>
                            <p className="text-zinc-400">
                                {banMessage || "You have been banned from this session."}
                            </p>
                        </div>

                        <button
                            onClick={handleLogout}
                            className="w-full py-4 bg-white text-black font-bold text-lg rounded-xl hover:bg-zinc-200 transition-colors"
                        >
                            Return to Login
                        </button>
                    </motion.div>
                </div>
            )}

            {/* 1. Top Navigation Bar */}
            <header className="h-14 bg-[#242424] text-white flex items-center justify-between px-4 z-20 shadow-md">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate('/')} className="hover:bg-white/10 p-2 rounded-lg transition-colors">
                        <Home size={20} />
                    </button>
                    <div className="h-6 w-px bg-white/20"></div>
                    <div className="flex items-center gap-2 cursor-pointer hover:bg-white/10 px-2 py-1 rounded-lg transition-colors">
                        <span className="font-semibold text-sm">Unified Canvas</span>
                        <ChevronLeft className="rotate-180 text-white/50" size={16} />
                    </div>
                </div>

                {/* Live Stats */}
                <div className="flex items-center gap-2 bg-black/30 px-3 py-1.5 rounded-full border border-white/10">
                    <span className="text-xs text-zinc-400">Total Strokes:</span>
                    <span className="font-mono text-sm font-bold text-white">{strokeCount !== null ? strokeCount.toLocaleString() : '---'}</span>
                    <button onClick={fetchStats} className="ml-2 hover:bg-white/10 p-1 rounded-full transition-colors">
                        <RefreshCw size={14} className="text-zinc-400 hover:text-white" />
                    </button>
                    <div className="w-px h-4 bg-white/20 mx-2"></div>
                    <span className="text-xs text-zinc-400">Last Ack:</span>
                    <span className={`font-mono text-sm font-bold ${lastAck ? 'text-green-400' : 'text-zinc-500'}`}>
                        {lastAck !== null ? lastAck : '-'}
                    </span>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center -space-x-2">
                        <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-xs font-bold border-2 border-[#242424]">
                            {user?.username.charAt(0).toUpperCase()}
                        </div>
                    </div>
                    <button onClick={handleLogout} className="hover:bg-white/10 p-2 rounded-lg transition-colors text-red-400">
                        <LogOut size={20} />
                    </button>
                </div>
            </header>

            {/* 2. Main Canvas Area */}
            <main className="flex-1 relative bg-dot-pattern">
                <canvas ref={canvasRef} className="absolute inset-0 z-0" />
            </main>

            {/* 3. Floating Toolbar */}
            <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-30 flex flex-col items-center gap-3">

                {/* Popover */}
                <AnimatePresence>
                    {showColorPicker && (
                        <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.9 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.9 }}
                            className="bg-white p-3 rounded-2xl shadow-xl border border-slate-200 mb-2 flex items-center gap-2"
                        >
                            {mode === 'erase' ? (
                                <div className="flex items-center gap-2 px-2">
                                    <span className="text-xs text-slate-500 font-medium whitespace-nowrap">Eraser Size</span>
                                    <input
                                        type="range"
                                        min="5"
                                        max="100"
                                        value={eraserSize}
                                        onChange={(e) => setEraserSize(Number(e.target.value))}
                                        className="w-32 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-600"
                                    />
                                </div>
                            ) : (
                                <>
                                    {/* Preset Colors */}
                                    {COLOR_PALETTE.map(c => (
                                        <button
                                            key={c}
                                            onClick={() => updateBrushColor(c)}
                                            className={`w-6 h-6 rounded-full border border-slate-200 ${currentConfig.color === c ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
                                            style={{ backgroundColor: c }}
                                        />
                                    ))}

                                    <div className="w-px h-6 bg-slate-200 mx-1"></div>

                                    {/* Rainbow / Galaxy Option */}
                                    <button
                                        onClick={() => updateBrushColor('rainbow')}
                                        className={`w-6 h-6 rounded-full border border-slate-200 bg-gradient-to-br from-red-400 via-yellow-400 to-blue-500 ${currentConfig.color === 'rainbow' ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
                                        title="Galaxy"
                                    />

                                    {/* Custom Picker */}
                                    <div className="relative w-6 h-6 rounded-full overflow-hidden border border-slate-200 bg-conic-gradient">
                                        <input
                                            type="color"
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                            value={currentConfig.color === 'rainbow' ? '#000000' : currentConfig.color}
                                            onChange={(e) => updateBrushColor(e.target.value)}
                                        />
                                        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                            <Palette size={12} className="text-slate-600" />
                                        </div>
                                    </div>
                                </>
                            )}

                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Dock */}
                <motion.div
                    initial={{ y: 50, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="bg-white p-3 rounded-full shadow-2xl flex items-center gap-3 border border-slate-200"
                >
                    {/* Selector */}
                    <button
                        onClick={activateSelect}
                        className={`p-3 rounded-full transition-colors ${mode === 'select' ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-100 text-slate-500'}`}
                    >
                        <MousePointer2 size={24} />
                    </button>

                    <div className="w-px h-6 bg-slate-200 mx-1"></div>

                    {/* Brushes */}
                    <div className="flex items-center gap-3 px-2">
                        {(Object.keys(DEFAULT_PRESETS) as BrushType[]).map((type) => {
                            const config = brushConfigs[type];
                            const isActive = mode === 'draw' && activeBrush === type;
                            const isRainbow = config.color === 'rainbow';

                            return (
                                <div key={type} className="relative flex flex-col items-center">
                                    <button
                                        onClick={() => selectBrush(type)}
                                        className={`
                                            relative w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200
                                            ${isActive ? 'scale-110 ring-2 ring-offset-2 ring-blue-500 shadow-md' : 'hover:scale-105 hover:bg-slate-100'}
                                        `}
                                        style={{
                                            background: isRainbow
                                                ? 'linear-gradient(135deg, #ef4444, #eab308, #3b82f6, #a855f7)'
                                                : config.color === '#000000' && !isActive ? '#f1f5f9' : isActive ? config.color : '#ffffff'
                                        }}
                                    >
                                        <config.icon
                                            size={20}
                                            className={`
                                                ${isActive || isRainbow ? 'text-white' : 'text-slate-600'}
                                                ${config.color === '#ffffff' && isActive ? 'text-slate-900' : ''}
                                            `}
                                            style={config.color === '#ffffff' && isActive ? { color: 'black' } : {}}
                                        />

                                        {!isActive && !isRainbow && (
                                            <div
                                                className="absolute bottom-0 right-0 w-3 h-3 rounded-full border border-white"
                                                style={{ backgroundColor: config.color }}
                                            />
                                        )}
                                    </button>

                                    {/* Small indicator if picker is open for this tool */}
                                    {isActive && showColorPicker && (
                                        <div className="absolute -top-2 w-1.5 h-1.5 bg-blue-500 rounded-full" />
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <div className="w-px h-6 bg-slate-200 mx-1"></div>

                    {/* Eraser */}
                    <div className="relative flex flex-col items-center">
                        <button
                            onClick={toggleEraser}
                            className={`p-3 rounded-full transition-colors ${mode === 'erase' ? 'bg-slate-200 text-slate-800' : 'hover:bg-slate-100 text-slate-500'}`}
                            title="Eraser"
                        >
                            <Eraser size={24} />
                        </button>
                        {mode === 'erase' && showColorPicker && (
                            <div className="absolute -top-2 w-1.5 h-1.5 bg-blue-500 rounded-full" />
                        )}
                    </div>

                    <button
                        onClick={handleClear}
                        className="p-3 rounded-full hover:bg-red-50 text-red-500 transition-colors"
                        title="Clear All"
                    >
                        <Trash2 size={24} />
                    </button>

                    <button className="p-3 rounded-full hover:bg-slate-100 text-slate-500 transition-colors">
                        <MoreHorizontal size={24} />
                    </button>

                </motion.div>
            </div>

            {/* 4. Interactive Lanyard Widget */}
            <div className="absolute top-20 left-4 w-48 h-64 z-50 hidden md:block">
                <Lanyard position={[0, 0, 15]} gravity={[0, -40, 0]} />
            </div>

        </div>
    );
};

export default Canvas;
