import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

const THRESHOLD = 0.9;

type Props = {
  disabled?: boolean;
  onComplete(): void;
};

/** 端までスライドすると `onComplete` を呼ぶ。タップだけでは開始しない。 */
export function SlideToStart({ disabled = false, onComplete }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef<number | null>(null);
  const [progress, setProgress] = useState(0);

  const travel = () => {
    const track = trackRef.current;
    if (!track) return 1;
    const knob = track.querySelector<HTMLElement>(".slide-knob");
    return Math.max(1, track.clientWidth - (knob?.offsetWidth ?? 0) - 8);
  };

  const finish = (value: number) => {
    dragStartX.current = null;
    if (value >= THRESHOLD) {
      setProgress(1);
      onComplete();
    }
    setTimeout(() => setProgress(0), value >= THRESHOLD ? 400 : 0);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartX.current = event.clientX;
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return;
    const value = (event.clientX - dragStartX.current) / travel();
    setProgress(Math.min(1, Math.max(0, value)));
  };
  const onPointerUp = () => {
    if (dragStartX.current === null) return;
    finish(progress);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || event.key !== "ArrowRight") return;
    event.preventDefault();
    const value = Math.min(1, progress + 0.25);
    if (value >= THRESHOLD) finish(value);
    else setProgress(value);
  };

  return (
    <div ref={trackRef} className={`slide-track${disabled ? " disabled" : ""}`}>
      <span className="slide-label">スライドして開始</span>
      <div
        className="slide-knob"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="スライドして開始（右矢印キーでも操作できます）"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-disabled={disabled}
        style={{ transform: `translateX(${progress * travel()}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => finish(0)}
        onKeyDown={onKeyDown}
      >
        ›
      </div>
    </div>
  );
}
