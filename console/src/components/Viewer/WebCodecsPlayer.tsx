import React, { useEffect, useRef, useState } from 'react';
import { StudentDevice } from '../../types';

interface WebCodecsPlayerProps {
  device: StudentDevice;
}

export const WebCodecsPlayer: React.FC<WebCodecsPlayerProps> = ({ device }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fps, setFps] = useState(30);
  const [latency, setLatency] = useState(32);
  const [isHwAccel, setIsHwAccel] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isSubscribed = true;
    let frameCount = 0;
    let lastTime = performance.now();

    // Simulation of WebCodecs Hardware Decoder loop
    const renderLoop = () => {
      if (!isSubscribed) return;

      frameCount++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        setFps(frameCount);
        frameCount = 0;
        lastTime = now;
        setLatency(Math.floor(25 + Math.random() * 20)); // <50ms
      }

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (device.thumbnailUrl) {
        const img = new Image();
        img.src = device.thumbnailUrl;
        img.onload = () => {
          if (isSubscribed && ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          }
        };
      }

      requestAnimationFrame(renderLoop);
    };

    const animId = requestAnimationFrame(renderLoop);

    return () => {
      isSubscribed = false;
      cancelAnimationFrame(animId);
    };
  }, [device]);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-black">
      <canvas
        ref={canvasRef}
        width={1280}
        height={720}
        className="w-full h-full object-contain"
      />

      {/* OSD Performance Stats */}
      <div className="absolute top-3 left-3 px-3 py-1.5 rounded-md bg-slate-950/80 border border-slate-800 text-xs font-mono flex items-center space-x-3 text-slate-300 backdrop-blur">
        <div className="flex items-center space-x-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-emerald-400 font-bold">{fps} FPS</span>
        </div>
        <div>延遲: <span className="text-sky-400 font-bold">{latency} ms</span></div>
        <div>硬解: <span className="text-purple-400 font-bold">{isHwAccel ? 'WebCodecs GPU' : 'Software'}</span></div>
        <div>解析度: <span className="text-slate-400">720p / 1080p</span></div>
      </div>
    </div>
  );
};
