import { useEffect, useRef } from 'react';
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

    // Keep track of refs for event listeners
    const colorRef = useRef(color);
    const modeRef = useRef(mode);
    useEffect(() => {
        colorRef.current = color;
        modeRef.current = mode;
    }, [color, mode]);

    useEffect(() => {
        if (!canvasRef.current) return;

        // Initialize Fabric
        const canvas = new fabric.Canvas(canvasRef.current, {
            isDrawingMode: true,
            width: window.innerWidth,
            height: window.innerHeight,
            backgroundColor: 'transparent',
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
                path.set('stroke', 'white'); // Color opacity matters for erasure strength
                path.set('selectable', false);
                path.set('evented', false);
                canvas.renderAll();
            }

            // Apply Gradient if Rainbow & Drawing
            else if (colorRef.current === 'rainbow') {
                const gradient = new fabric.Gradient({
                    type: 'linear',
                    gradientUnits: 'percentage',
                    coords: { x1: 0, y1: 0, x2: 1, y2: 1 },
                    colorStops: [
                        { offset: 0, color: '#ef4444' },    // Red
                        { offset: 0.16, color: '#f97316' }, // Orange
                        { offset: 0.33, color: '#eab308' }, // Yellow
                        { offset: 0.5, color: '#22c55e' },  // Green
                        { offset: 0.66, color: '#3b82f6' }, // Blue
                        { offset: 0.83, color: '#6366f1' }, // Indigo
                        { offset: 1, color: '#a855f7' }     // Violet
                    ]
                });
                path.set('stroke', gradient);
                canvas.renderAll();
            }

            // Serialize and emit
            // Include 'selectable', 'evented', and 'globalCompositeOperation' to ensure eraser locks persist
            const json = path.toJSON(['selectable', 'evented', 'globalCompositeOperation']);
            socket.emit('draw_stroke', { canvasId, stroke: json });
        });

        // Socket: Connect & Listen
        socket.connect();
        socket.emit('join_canvas', canvasId);

        const handleStroke = (obj: any) => {
            isReceiving.current = true;
            fabric.util.enlivenObjects([obj], (objects: fabric.Object[]) => {
                objects.forEach((o) => {
                    // Enforce eraser logic on incoming objects
                    if (o.globalCompositeOperation === 'destination-out') {
                        o.set('selectable', false);
                        o.set('evented', false);
                    }
                    canvas.add(o);
                });
                canvas.renderAll();
                isReceiving.current = false;
            }, 'fabric');
        };

        const handleInit = (objects: any[]) => {
            isReceiving.current = true;
            canvas.clear();
            canvas.setBackgroundColor('transparent', () => { });

            fabric.util.enlivenObjects(objects, (objs: fabric.Object[]) => {
                objs.forEach((o) => {
                    // Enforce eraser logic on initial load
                    if (o.globalCompositeOperation === 'destination-out') {
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

        socket.on('stroke', handleStroke);
        socket.on('init_canvas', handleInit);
        socket.on('clear_canvas', handleClear);

        const resize = () => {
            canvas.setWidth(window.innerWidth);
            canvas.setHeight(window.innerHeight);
        };
        window.addEventListener('resize', resize);

        return () => {
            socket.off('stroke', handleStroke);
            socket.off('init_canvas', handleInit);
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
            canvas.selection = true; // Enable object selection
            canvas.defaultCursor = 'default';
            canvas.hoverCursor = 'move';
        } else {
            // Draw or Erase
            canvas.isDrawingMode = true;
            canvas.selection = false;

            if (canvas.freeDrawingBrush) {
                canvas.freeDrawingBrush.width = size;

                if (mode === 'erase') {
                    // Eraser: Use simple faint white brush for preview
                    // The actual path will be converted to destination-out on creation
                    canvas.freeDrawingBrush.color = 'rgba(255, 255, 255, 0.5)';
                    canvas.freeDrawingCursor = 'crosshair'; // Better UX than not-allowed
                } else {
                    // Draw Mode
                    canvas.freeDrawingCursor = 'crosshair';

                    // Handle Color & Opacity
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

        // Global Safety Check: Ensure all eraser strokes are locked interactively
        // This fixes "still same" issues where existing objects might be selectable
        canvas.getObjects().forEach((obj) => {
            if (obj.globalCompositeOperation === 'destination-out') {
                obj.set({ selectable: false, evented: false });
            }
        });
        canvas.requestRenderAll();

    }, [color, size, opacity, isEditor, mode]);

    return {
        canvasRef
    };
};
