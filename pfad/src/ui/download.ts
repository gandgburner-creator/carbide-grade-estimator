import type { Provenance } from '../app/provenance';

export function downloadText(name: string, text: string, type = 'text/plain') {
  downloadBlob(name, new Blob([text], { type }));
}

export function downloadBlob(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** PNG of a canvas with a caption strip: what is shown, and the provenance. */
export function downloadCanvasPNG(name: string, canvas: HTMLCanvasElement, caption: string[], p: Provenance | null) {
  const lines = [...caption, p ? `code ${p.codeVersion} · model ${p.modelVersion} · ${p.experimentType} · seeds ${p.seeds.join(',')} · ${p.units}` : ''].filter(Boolean);
  const lh = 16;
  const out = document.createElement('canvas');
  out.width = canvas.width;
  const scale = canvas.width / Math.max(1, canvas.clientWidth);
  out.height = canvas.height + Math.round((lines.length * lh + 10) * scale);
  const g = out.getContext('2d')!;
  g.fillStyle = '#0b0e12';
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(canvas, 0, 0);
  g.scale(scale, scale);
  g.fillStyle = '#c9d1d9';
  g.font = '11px ui-monospace, monospace';
  lines.forEach((l, i) => g.fillText(l, 8, canvas.height / scale + 14 + i * lh));
  out.toBlob((b) => b && downloadBlob(name, b), 'image/png');
}
