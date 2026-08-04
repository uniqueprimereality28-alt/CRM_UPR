import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { ZoomIn, Loader2, Check } from "lucide-react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";

// Square preview stage the user drags/zooms within (CSS px).
const STAGE_SIZE = 280;
// Exported image resolution (px). Square, matches the circular preview.
const OUTPUT_SIZE = 512;

/**
 * Modal that lets the user pan and zoom a picked image inside a circular
 * frame, then exports exactly what's visible in that frame as a square
 * JPEG blob — so profile pictures always land centered instead of an
 * arbitrary crop of the original photo.
 */
export default function AvatarCropperDialog({ file, open, onOpenChange, onConfirm, busy }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef(null); // { startX, startY, originX, originY, pointerId }

  const [imgReady, setImgReady] = useState(false);
  const [zoom, setZoom] = useState(1); // 1x = smallest scale that fully covers the stage
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    if (!objectUrl) return;
    setImgReady(false);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    const img = new Image();
    img.onload = () => { imgRef.current = img; setImgReady(true); };
    img.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectUrl]);

  const baseScale = useCallback(() => {
    const img = imgRef.current;
    if (!img) return 1;
    return Math.max(STAGE_SIZE / img.naturalWidth, STAGE_SIZE / img.naturalHeight);
  }, []);

  const clampOffset = useCallback((next, z) => {
    const img = imgRef.current;
    if (!img) return { x: 0, y: 0 };
    const scale = baseScale() * z;
    const dispW = img.naturalWidth * scale;
    const dispH = img.naturalHeight * scale;
    const maxX = Math.max(0, (dispW - STAGE_SIZE) / 2);
    const maxY = Math.max(0, (dispH - STAGE_SIZE) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }, [baseScale]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    const scale = baseScale() * zoom;
    const dispW = img.naturalWidth * scale;
    const dispH = img.naturalHeight * scale;
    const x = (STAGE_SIZE - dispW) / 2 + offset.x;
    const y = (STAGE_SIZE - dispH) / 2 + offset.y;

    ctx.clearRect(0, 0, STAGE_SIZE, STAGE_SIZE);
    ctx.drawImage(img, x, y, dispW, dispH);

    // Dim everything outside the circular frame so it's obvious what's
    // actually going to be kept, without hiding the rest of the photo.
    ctx.save();
    ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
    ctx.beginPath();
    ctx.rect(0, 0, STAGE_SIZE, STAGE_SIZE);
    ctx.arc(STAGE_SIZE / 2, STAGE_SIZE / 2, STAGE_SIZE / 2, 0, Math.PI * 2, true);
    ctx.fill("evenodd");
    ctx.restore();

    ctx.beginPath();
    ctx.arc(STAGE_SIZE / 2, STAGE_SIZE / 2, STAGE_SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [baseScale, offset, zoom]);

  useEffect(() => { if (imgReady) draw(); }, [imgReady, draw]);

  const onPointerDown = (e) => {
    if (!imgReady) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      originX: offset.x, originY: offset.y,
      pointerId: e.pointerId,
    };
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset(clampOffset({ x: dragRef.current.originX + dx, y: dragRef.current.originY + dy }, zoom));
  };
  const endDrag = (e) => {
    if (dragRef.current && e.currentTarget.hasPointerCapture?.(dragRef.current.pointerId)) {
      e.currentTarget.releasePointerCapture(dragRef.current.pointerId);
    }
    dragRef.current = null;
  };

  const onZoomChange = ([z]) => {
    setZoom(z);
    setOffset((prev) => clampOffset(prev, z));
  };

  const handleConfirm = () => {
    const img = imgRef.current;
    if (!img) return;
    const out = document.createElement("canvas");
    out.width = OUTPUT_SIZE;
    out.height = OUTPUT_SIZE;
    const ctx = out.getContext("2d");
    const ratio = OUTPUT_SIZE / STAGE_SIZE;
    const scale = baseScale() * zoom * ratio;
    const dispW = img.naturalWidth * scale;
    const dispH = img.naturalHeight * scale;
    const x = (OUTPUT_SIZE - dispW) / 2 + offset.x * ratio;
    const y = (OUTPUT_SIZE - dispH) / 2 + offset.y * ratio;
    ctx.drawImage(img, x, y, dispW, dispH);
    out.toBlob((blob) => { if (blob) onConfirm(blob); }, "image/jpeg", 0.92);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjust your picture</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <div
            className="relative touch-none select-none overflow-hidden rounded-lg bg-slate-900"
            style={{ width: STAGE_SIZE, height: STAGE_SIZE, cursor: imgReady ? "grab" : "default" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            data-testid="avatar-crop-stage"
          >
            {!imgReady && (
              <div className="absolute inset-0 grid place-items-center">
                <Loader2 className="h-5 w-5 animate-spin text-white/70" />
              </div>
            )}
            <canvas ref={canvasRef} width={STAGE_SIZE} height={STAGE_SIZE} />
          </div>

          <div className="flex w-full items-center gap-3">
            <ZoomIn className="h-4 w-4 shrink-0 text-slate-400" />
            <Slider
              value={[zoom]}
              min={1}
              max={3}
              step={0.01}
              onValueChange={onZoomChange}
              disabled={!imgReady}
              data-testid="avatar-crop-zoom"
            />
          </div>
          <p className="text-center text-[11px] text-slate-400">
            Drag the photo to reposition it, use the slider to zoom. Only what's inside the circle will be used.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!imgReady || busy}
            className="gap-2 bg-brand hover:bg-brand-dark" data-testid="avatar-crop-confirm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save picture
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
