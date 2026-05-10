import * as THREE from 'three';

export type LabelSprite = THREE.Sprite & { material: THREE.SpriteMaterial & { map: THREE.CanvasTexture } };

export function makeAtomTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 96, 96);

    const corona = ctx.createRadialGradient(48, 48, 5, 48, 48, 31);
    corona.addColorStop(0, 'rgba(255,255,255,0.34)');
    corona.addColorStop(0.34, 'rgba(255,255,255,0.12)');
    corona.addColorStop(0.68, 'rgba(255,255,255,0.032)');
    corona.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = corona;
    ctx.fillRect(0, 0, 96, 96);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    strokeFlare(ctx, 48, 48, 18, 0, 1.35, 0.34);
    strokeFlare(ctx, 48, 48, 15, Math.PI * 0.5, 1.05, 0.28);
    strokeFlare(ctx, 48, 48, 10, Math.PI * 0.25, 0.7, 0.18);
    strokeFlare(ctx, 48, 48, 10, Math.PI * 0.75, 0.7, 0.18);
    ctx.restore();

    const core = ctx.createRadialGradient(43, 40, 1.5, 48, 48, 13.5);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.36, 'rgba(255,255,255,0.98)');
    core.addColorStop(0.76, 'rgba(235,242,255,0.82)');
    core.addColorStop(1, 'rgba(255,255,255,0.16)');
    ctx.beginPath();
    ctx.arc(48, 48, 13.5, 0, Math.PI * 2);
    ctx.fillStyle = core;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(48, 48, 15.2, 0, Math.PI * 2);
    ctx.lineWidth = 1.35;
    ctx.strokeStyle = 'rgba(255,255,255,0.58)';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(43, 40, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.fill();

    return canvasTexture(canvas);
}

export function makeNodeTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 96, 96);
    ctx.beginPath();
    ctx.arc(48, 48, 12.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.fill();
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = 'rgba(5,8,14,0.88)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(48, 48, 22.5, 0, Math.PI * 2);
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = 'rgba(255,255,255,0.66)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(48, 48, 29, 0, Math.PI * 2);
    ctx.lineWidth = 3.8;
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.stroke();
    return canvasTexture(canvas);
}

export function makeHaloTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(48, 48, 0, 48, 48, 46);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.42, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.52, 'rgba(255,255,255,0.18)');
    gradient.addColorStop(0.66, 'rgba(255,255,255,0.045)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 96, 96);
    return canvasTexture(canvas);
}

export function makeLabelSprite(text: string, active: boolean): LabelSprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 72;
    const ctx = canvas.getContext('2d')!;
    ctx.font = `${active ? 700 : 650} 24px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const width = Math.min(236, Math.max(72, ctx.measureText(text).width + 30));
    const left = (256 - width) / 2;
    roundRect(ctx, left, 14, width, 44, 14);
    ctx.fillStyle = active ? 'rgba(15,23,42,0.84)' : 'rgba(3,7,18,0.62)';
    ctx.fill();
    ctx.strokeStyle = active ? 'rgba(45,212,191,0.65)' : 'rgba(168,85,247,0.28)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = active ? 'rgb(240,253,250)' : 'rgb(221,214,254)';
    ctx.fillText(text.length > 22 ? `${text.slice(0, 20)}...` : text, 128, 36);
    const material = new THREE.SpriteMaterial({ map: canvasTexture(canvas), transparent: true, depthWrite: false, depthTest: false });
    return new THREE.Sprite(material) as LabelSprite;
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function strokeFlare(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    length: number,
    angle: number,
    width: number,
    opacity: number,
): void {
    const dx = Math.cos(angle) * length;
    const dy = Math.sin(angle) * length;
    const gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.5, `rgba(255,255,255,${opacity})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.moveTo(cx - dx, cy - dy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.lineWidth = width;
    ctx.strokeStyle = gradient;
    ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
}
