import { useEffect, useRef, useState } from 'react';
import { fabric } from 'fabric';
import { socket } from '../socket';

export const useCanvas = (
    canvasId: string,
    mode: 'draw' | 'select' | 'erase',
    color: string,
    size: number,
    opacity: number | undefined,
    isEditor: boolean
) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fabricRef = useRef<fabric.Canvas | null>(null);
    const isReceiving = useRef(false);

    // Optimization: Buffer Queue
    const incomingStrokes = useRef<any[]>([]);
    const rafId = useRef<number | null>(null);
    const [lastAck, setLastAck] = useState<number | null>(null);

    // Keep track of refs for event listeners
    const colorRef = useRef(color);
    const modeRef = useRef(mode);
    useEffect(() => {
        colorRef.current = color;
        modeRef.current = mode;
    }, [color, mode]);

    // RENDER LOOP
    useEffect(() => {
        const loop = () => {
            const canvas = fabricRef.current;
            if (!canvas) {
                rafId.current = requestAnimationFrame(loop);
                return;
            }

            // 1. Process Queue (Higher limit for loading phase)
            const MAX_PROCESS = isReceiving.current ? 2000 : 50;
            const toProcess = incomingStrokes.current.splice(0, MAX_PROCESS); // Take batch

            if (toProcess.length > 0) {
                isReceiving.current = true;
                fabric.util.enlivenObjects(toProcess, (objects: fabric.Object[]) => {

                    // Filter logic moved or simplified

                    // Add to canvas
                    objects.forEach(o => {
                        if ((o as any).globalCompositeOperation === 'destination-out') {
                            o.set('selectable', false);
                            o.set('evented', false);
                        }
                        canvas.add(o);
                    });

                    // 2. Rasterization Check (Check less frequently)
                    const objs = canvas.getObjects();
                    if (objs.length > 3000) {
                        // Take snapshot of current state
                        const dataUrl = canvas.toDataURL({ format: 'png', multiplier: 1 });

                        // Clear all objects (except active selection ideally, but simpler to clear all)
                        canvas.clear();

                        // Set snapshot as background
                        canvas.setBackgroundImage(dataUrl, canvas.renderAll.bind(canvas), {
                            originX: 'left',
                            originY: 'top'
                        });

                        // If there were pending items in queue, they will be drawn on top next frame.
                    } else {
                        canvas.requestRenderAll();
                    }

                    isReceiving.current = false;
                }, 'fabric');
            }

            rafId.current = requestAnimationFrame(loop);
        };

        rafId.current = requestAnimationFrame(loop);

        return () => {
            if (rafId.current) cancelAnimationFrame(rafId.current);
        };
    }, []);

    useEffect(() => {
        if (!canvasRef.current) return;

        // Initialize Fabric
        const canvas = new fabric.Canvas(canvasRef.current, {
            isDrawingMode: true,
            width: window.innerWidth,
            height: window.innerHeight,
            backgroundColor: 'transparent',
            renderOnAddRemove: false // OPTIMIZATION: Manual rendering
        });

        fabricRef.current = canvas;

        // Setup Brush
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
        canvas.freeDrawingBrush.width = size;

        // Initial Color Setup
        const initialColor = color === 'rainbow' ? 'black' : color;
        canvas.freeDrawingBrush.color = initialColor;

        // Event: Path Created (Local Drawing)
        canvas.on('path:created', (e: any) => {
            if (isReceiving.current) return;
            const path = e.path;
            if (!path) return;

            // Handle Eraser Mode (Destination Out)
            if (modeRef.current === 'erase') {
                path.globalCompositeOperation = 'destination-out';
                path.set('stroke', 'white');
                path.set('selectable', false);
                path.set('evented', false);
            }

            // Apply Gradient if Rainbow 
            else if (colorRef.current === 'rainbow') {
                const gradient = new fabric.Gradient({
                    type: 'linear', gradientUnits: 'percentage', coords: { x1: 0, y1: 0, x2: 1, y2: 1 },
                    colorStops: [
                        { offset: 0, color: '#ef4444' }, { offset: 0.16, color: '#f97316' }, { offset: 0.33, color: '#eab308' },
                        { offset: 0.5, color: '#22c55e' }, { offset: 0.66, color: '#3b82f6' }, { offset: 0.83, color: '#6366f1' }, { offset: 1, color: '#a855f7' }
                    ]
                });
                path.set('stroke', gradient);
            }

            canvas.requestRenderAll(); // Render local stroke immediately

            // Serialize and emit
            const json = path.toJSON(['selectable', 'evented', 'globalCompositeOperation']);
            console.log('[TRACE] Emitting stroke', canvasId);
            socket.emit('draw_stroke', { canvasId, stroke: json });
        });

        // Socket: Connect & Listen
        socket.connect();
        socket.emit('join_canvas', canvasId);

        // Batch Handler
        const handleBatchStrokes = (strokes: any[]) => {
            // Filter own strokes here efficiently
            const others = strokes.filter(s => s.senderSocketId !== socket.id);
            if (others.length > 0) {
                incomingStrokes.current.push(...others);
            }
        };

        // Single Handler (fallback)
        const handleStroke = (obj: any) => {
            if (obj.senderSocketId !== socket.id) {
                incomingStrokes.current.push(obj);
            }
        };

        const handleInit = (objects: any[]) => {
            isReceiving.current = true;
            canvas.clear();
            canvas.setBackgroundColor('transparent', () => { });

            fabric.util.enlivenObjects(objects, (objs: fabric.Object[]) => {
                objs.forEach((o) => {
                    if ((o as any).globalCompositeOperation === 'destination-out') {
                        o.set('selectable', false);
                        o.set('evented', false);
                    }
                    canvas.add(o);
                });
                canvas.renderAll();
                isReceiving.current = false;
            }, 'fabric');
        };

        const handleClear = () => {
            canvas.clear();
            canvas.setBackgroundColor('transparent', () => { });
        };

        // Streaming Init Handlers
        const handleInitStart = (data: { total: number }) => {
            isReceiving.current = true;
            canvas.clear();
            canvas.setBackgroundColor('transparent', () => { });
            // Optionally update UI loading state here via another hook or context
            console.log(`Loading ${data.total} strokes...`);
        };

        const handleInitChunk = (objects: any[]) => {
            // Push to buffer logic similar to batching
            // We can just add them to incomingStrokes, but we might want to prioritize them.
            // Actually, adding to `incomingStrokes` is perfect because the RAF loop handles enliven + rasterization.
            // We just need to make sure we don't overwhelm it. 
            // Since we receive chunks of 1000 and RAF cleans 50/frame, it might backlog.
            // But RAF loop is robust.
            incomingStrokes.current.push(...objects);
        };

        const handleInitEnd = () => {
            // RAF loop will eventually finish processing.
            // We force isReceiving to false here to ensure manual drawing is enabled
            // in case the queue was empty (empty canvas).
            isReceiving.current = false;
            console.log("History loaded.");
        };

        socket.on('stroke', handleStroke);
        socket.on('batch_strokes', handleBatchStrokes);
        // socket.on('init_canvas', handleInit); // OLD legacy

        socket.on('init_canvas_start', handleInitStart);
        socket.on('init_canvas_chunk', handleInitChunk);
        socket.on('init_canvas_end', handleInitEnd);

        socket.on('stroke_ack', (data: { seq: number }) => {
            console.log(`Stroke acknowledged: ${data.seq}`);
            setLastAck(data.seq);
        });

        socket.on('clear_canvas', handleClear);

        const resize = () => {
            canvas.setWidth(window.innerWidth);
            canvas.setHeight(window.innerHeight);
        };
        window.addEventListener('resize', resize);

        return () => {
            socket.off('stroke', handleStroke);
            socket.off('batch_strokes', handleBatchStrokes);
            socket.off('init_canvas', handleInit);
            socket.off('init_canvas_start', handleInitStart);
            socket.off('init_canvas_chunk', handleInitChunk);
            socket.off('init_canvas_end', handleInitEnd);
            socket.off('stroke_ack', (data: { seq: number }) => {
                console.log(`ACK stroke: ${data.seq}`);
            });
            socket.off('clear_canvas', handleClear);
            window.removeEventListener('resize', resize);
            canvas.dispose();
            socket.disconnect();
        };
    }, [canvasId]);

    // Update Brush Attributes & Cursor
    useEffect(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        // Permissions
        if (!isEditor) {
            canvas.isDrawingMode = false;
            canvas.selection = false;
            return;
        }

        // Mode Handling
        if (mode === 'select') {
            canvas.isDrawingMode = false;
            canvas.selection = true;
            canvas.defaultCursor = 'default';
            canvas.hoverCursor = 'move';
        } else {
            canvas.isDrawingMode = true;
            canvas.selection = false;

            if (canvas.freeDrawingBrush) {
                canvas.freeDrawingBrush.width = size;
                if (mode === 'erase') {
                    canvas.freeDrawingBrush.color = 'rgba(255, 255, 255, 0.5)';
                    canvas.freeDrawingCursor = 'crosshair';
                } else {
                    canvas.freeDrawingCursor = 'crosshair';
                    if (color === 'rainbow') {
                        canvas.freeDrawingBrush.color = 'black';
                    } else {
                        const c = new fabric.Color(color);
                        c.setAlpha(opacity ?? 1);
                        canvas.freeDrawingBrush.color = c.toRgba();
                    }
                }
            }
        }
        canvas.requestRenderAll();

    }, [color, size, opacity, isEditor, mode]);

    return {
        canvasRef,
        lastAck
    };
};
