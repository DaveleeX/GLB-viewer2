import QRCode from 'qrcode';

export async function drawQr(canvas: HTMLCanvasElement, text: string): Promise<void> {
  await QRCode.toCanvas(canvas, text, {
    width: Math.max(canvas.width, 280),
    margin: 2,
    color: {
      dark: '#0b1220',
      light: '#f4f7ff',
    },
    errorCorrectionLevel: 'M',
  });
}
