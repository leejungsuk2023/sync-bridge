'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Pencil, Undo2, Trash2, Send } from 'lucide-react';

interface Point { x: number; y: number; }
interface TextNote { x: number; y: number; text: string; }
type Action = { type: 'stroke' } | { type: 'note' };

interface ImageAnnotatorProps {
  imageUrl: string;
  imageName: string;
  onSend: (blob: Blob, fileName: string) => Promise<void>;
  onClose: () => void;
}

export default function ImageAnnotator({ imageUrl, imageName, onSend, onClose }: ImageAnnotatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);

  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [currentStroke, setCurrentStroke] = useState<Point[]>([]);
  const [notes, setNotes] = useState<TextNote[]>([]);
  const [actionHistory, setActionHistory] = useState<Action[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [sending, setSending] = useState(false);
  const [canvasDims, setCanvasDims] = useState({ width: 0, height: 0 });
  const [notePopup, setNotePopup] = useState<{ x: number; y: number } | null>(null);
  const [noteText, setNoteText] = useState('');

  // Calculate and set canvas dimensions to match displayed image
  const updateCanvasDims = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    setCanvasDims({ width: rect.width, height: rect.height });
  }, []);

  // Update canvas dims on image load
  const handleImageLoad = useCallback(() => {
    updateCanvasDims();
  }, [updateCanvasDims]);

  // Handle window resize
  useEffect(() => {
    window.addEventListener('resize', updateCanvasDims);
    return () => window.removeEventListener('resize', updateCanvasDims);
  }, [updateCanvasDims]);

  // Draw all strokes on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const allStrokes = [...strokes, ...(currentStroke.length > 0 ? [currentStroke] : [])];

    for (const stroke of allStrokes) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) {
        ctx.lineTo(stroke[i].x, stroke[i].y);
      }
      ctx.stroke();
    }
  }, [strokes, currentStroke, canvasDims]);

  // Focus textarea when note popup appears
  useEffect(() => {
    if (notePopup && noteInputRef.current) {
      noteInputRef.current.focus();
    }
  }, [notePopup]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (notePopup) {
          setNotePopup(null);
          setNoteText('');
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [notePopup, onClose]);

  // Get mouse position relative to canvas
  const getCanvasPos = (e: React.MouseEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  // Drawing handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    if (notePopup) return;
    setIsDrawing(true);
    const pos = getCanvasPos(e);
    setCurrentStroke([pos]);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing) return;
    const pos = getCanvasPos(e);
    setCurrentStroke(prev => [...prev, pos]);
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentStroke.length > 1) {
      setStrokes(prev => [...prev, currentStroke]);
      setActionHistory(prev => [...prev, { type: 'stroke' }]);
    }
    setCurrentStroke([]);
  };

  // Right-click to add text note
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const pos = getCanvasPos(e);
    setNotePopup({ x: pos.x, y: pos.y });
    setNoteText('');
  };

  // Confirm note
  const confirmNote = () => {
    if (!notePopup || !noteText.trim()) {
      setNotePopup(null);
      setNoteText('');
      return;
    }
    setNotes(prev => [...prev, { x: notePopup.x, y: notePopup.y, text: noteText.trim() }]);
    setActionHistory(prev => [...prev, { type: 'note' }]);
    setNotePopup(null);
    setNoteText('');
  };

  // Delete a note by index
  const deleteNote = (index: number) => {
    setNotes(prev => prev.filter((_, i) => i !== index));
    // Remove the corresponding action from history
    let noteCount = 0;
    const targetNoteIndex = index;
    let actionIdx = -1;
    let currentNoteIdx = 0;
    for (let i = 0; i < actionHistory.length; i++) {
      if (actionHistory[i].type === 'note') {
        if (currentNoteIdx === targetNoteIndex) {
          actionIdx = i;
          break;
        }
        currentNoteIdx++;
      }
    }
    if (actionIdx !== -1) {
      setActionHistory(prev => prev.filter((_, i) => i !== actionIdx));
    }
  };

  // Undo last action
  const handleUndo = () => {
    if (actionHistory.length === 0) return;
    const lastAction = actionHistory[actionHistory.length - 1];
    if (lastAction.type === 'stroke') {
      setStrokes(prev => prev.slice(0, -1));
    } else if (lastAction.type === 'note') {
      setNotes(prev => prev.slice(0, -1));
    }
    setActionHistory(prev => prev.slice(0, -1));
  };

  // Clear all
  const handleClear = () => {
    if (strokes.length === 0 && notes.length === 0) return;
    if (!confirm('모든 그림과 메모를 지우시겠습니까?')) return;
    setStrokes([]);
    setNotes([]);
    setCurrentStroke([]);
    setActionHistory([]);
  };

  // Composite and send
  const handleSend = async () => {
    const img = imgRef.current;
    if (!img) return;

    setSending(true);

    try {
      // Load image with crossOrigin for compositing
      const sourceImg = new Image();
      sourceImg.crossOrigin = 'anonymous';

      await new Promise<void>((resolve, reject) => {
        sourceImg.onload = () => resolve();
        sourceImg.onerror = () => reject(new Error('Failed to load image for compositing'));
        sourceImg.src = imageUrl;
      });

      const naturalWidth = sourceImg.naturalWidth;
      const naturalHeight = sourceImg.naturalHeight;
      const displayedWidth = canvasDims.width;
      const displayedHeight = canvasDims.height;
      const scaleX = naturalWidth / displayedWidth;
      const scaleY = naturalHeight / displayedHeight;

      // Create offscreen canvas
      const offscreen = document.createElement('canvas');
      offscreen.width = naturalWidth;
      offscreen.height = naturalHeight;
      const ctx = offscreen.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');

      // Draw original image
      ctx.drawImage(sourceImg, 0, 0, naturalWidth, naturalHeight);

      // Draw strokes scaled to natural resolution
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3 * scaleX;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (const stroke of strokes) {
        if (stroke.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(stroke[0].x * scaleX, stroke[0].y * scaleY);
        for (let i = 1; i < stroke.length; i++) {
          ctx.lineTo(stroke[i].x * scaleX, stroke[i].y * scaleY);
        }
        ctx.stroke();
      }

      // Draw text notes as yellow rectangles with text
      for (const note of notes) {
        const sx = note.x * scaleX;
        const sy = note.y * scaleY;
        const fontSize = Math.max(14, 14 * scaleX);
        ctx.font = `${fontSize}px sans-serif`;

        // Measure text lines
        const lines = note.text.split('\n');
        const lineHeight = fontSize * 1.3;
        const padding = 8 * scaleX;
        let maxLineWidth = 0;
        for (const line of lines) {
          const m = ctx.measureText(line);
          if (m.width > maxLineWidth) maxLineWidth = m.width;
        }

        const boxWidth = maxLineWidth + padding * 2;
        const boxHeight = lines.length * lineHeight + padding * 2;

        // Draw yellow background
        ctx.fillStyle = '#fef3c7';
        ctx.fillRect(sx, sy, boxWidth, boxHeight);
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 1 * scaleX;
        ctx.strokeRect(sx, sy, boxWidth, boxHeight);

        // Draw text
        ctx.fillStyle = '#000000';
        ctx.font = `${fontSize}px sans-serif`;
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], sx + padding, sy + padding + fontSize + i * lineHeight);
        }

        // Reset stroke style for next iteration
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3 * scaleX;
      }

      // Convert to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        offscreen.toBlob(
          (b) => {
            if (b) resolve(b);
            else reject(new Error('Failed to create blob'));
          },
          'image/png'
        );
      });

      const fileName = 'annotated_' + imageName;
      await onSend(blob, fileName);
    } catch (err) {
      console.error('[ImageAnnotator] Failed to composite and send:', err);
      alert('이미지 전송에 실패했습니다.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center">
      {/* Close button (top right) */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/70 hover:text-white z-[60]"
        title="닫기"
      >
        <X size={28} />
      </button>

      {/* Image + Canvas container */}
      <div className="relative flex items-center justify-center flex-1 w-full p-4 pb-20">
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={imageUrl}
            alt={imageName}
            crossOrigin="anonymous"
            onLoad={handleImageLoad}
            className="max-w-[85vw] max-h-[70vh] object-contain select-none pointer-events-none"
            draggable={false}
          />

          {/* Drawing canvas overlaid on image */}
          {canvasDims.width > 0 && (
            <canvas
              ref={canvasRef}
              width={canvasDims.width}
              height={canvasDims.height}
              className="absolute top-0 left-0 cursor-crosshair"
              style={{ width: canvasDims.width, height: canvasDims.height }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onContextMenu={handleContextMenu}
            />
          )}

          {/* Rendered text notes */}
          {notes.map((note, i) => (
            <div
              key={i}
              className="absolute bg-amber-100 border border-amber-500 rounded shadow-md px-2 py-1 text-sm text-black max-w-[200px] whitespace-pre-wrap select-none"
              style={{ left: note.x, top: note.y, zIndex: 10 }}
            >
              <button
                onClick={() => deleteNote(i)}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600"
                title="삭제"
              >
                <X size={12} />
              </button>
              <span>{note.text}</span>
            </div>
          ))}

          {/* Note input popup */}
          {notePopup && (
            <div
              className="absolute z-20 bg-amber-100 border border-amber-500 rounded-lg shadow-lg p-2"
              style={{ left: notePopup.x, top: notePopup.y }}
            >
              <textarea
                ref={noteInputRef}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={3}
                className="w-[200px] bg-amber-50 border border-amber-300 rounded p-1 text-sm text-black resize-none focus:outline-none focus:ring-1 focus:ring-amber-400"
                placeholder="메모 입력..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    confirmNote();
                  }
                }}
              />
              <div className="flex gap-1 mt-1 justify-end">
                <button
                  onClick={() => {
                    setNotePopup(null);
                    setNoteText('');
                  }}
                  className="px-2 py-0.5 text-xs bg-gray-200 hover:bg-gray-300 rounded text-gray-700"
                >
                  취소
                </button>
                <button
                  onClick={confirmNote}
                  className="px-2 py-0.5 text-xs bg-amber-500 hover:bg-amber-600 text-white rounded"
                >
                  확인
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toolbar at bottom */}
      <div className="fixed bottom-0 left-0 right-0 z-[55] bg-black/60 backdrop-blur-sm border-t border-white/10 px-4 py-3 flex items-center justify-center gap-3">
        <button
          onClick={handleClear}
          disabled={sending}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
          title="모두 지우기"
        >
          <Trash2 size={16} />
          <span>지우기</span>
        </button>

        <button
          onClick={handleUndo}
          disabled={sending || actionHistory.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
          title="실행취소"
        >
          <Undo2 size={16} />
          <span>실행취소</span>
        </button>

        <div className="w-px h-6 bg-white/20" />

        <div className="flex items-center gap-2 text-white/50 text-xs">
          <Pencil size={14} />
          <span>드래그: 그리기 | 우클릭: 메모</span>
        </div>

        <div className="w-px h-6 bg-white/20" />

        <button
          onClick={handleSend}
          disabled={sending}
          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Send size={16} />
          <span>{sending ? '전송 중...' : '전송'}</span>
        </button>

        <button
          onClick={onClose}
          disabled={sending}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          <X size={16} />
          <span>닫기</span>
        </button>
      </div>
    </div>
  );
}
