import { useEffect, useRef } from 'preact/hooks';
import { hexToBytes } from '../../core/color';
import type { PixelImage } from '../../worker/protocol';
import { grid, highlight } from './controller';

export function RgbaCanvas({ img, pixelated }: { img: PixelImage | null; pixelated?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !img) return;
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
  }, [img]);
  return <canvas ref={ref} class={pixelated ? 'pixelated' : ''} />;
}

/** The matched grid, drawn from cell indices; cells of other colours are dimmed while one is highlighted. */
export function MatchedCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const g = grid.value;
  const hl = highlight.value;
  useEffect(() => {
    const c = ref.current;
    if (!c || !g) return;
    c.width = g.cols;
    c.height = g.rows;
    const rgb = g.colors.map((col) => hexToBytes(col.hex) ?? [128, 128, 128]);
    const data = new Uint8ClampedArray(g.cols * g.rows * 4);
    for (let i = 0; i < g.indices.length; i++) {
      const idx = g.indices[i];
      let [r, gg, b] = rgb[idx] ?? [128, 128, 128];
      if (hl !== null && idx !== hl) {
        r = r * 0.25 + 96;
        gg = gg * 0.25 + 96;
        b = b * 0.25 + 96;
      }
      data[i * 4] = r;
      data[i * 4 + 1] = gg;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    }
    c.getContext('2d')!.putImageData(new ImageData(data, g.cols, g.rows), 0, 0);
  }, [g, hl]);
  return <canvas ref={ref} class="pixelated" />;
}
