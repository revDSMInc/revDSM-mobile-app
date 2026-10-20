/**
 * The page the hidden WebView renders to flatten an annotated photo (photo + ink + shapes + text -> JPEG).
 *
 * Moved verbatim out of `screens/ImageAnnotation` when saving became a background job (see
 * `services/annotationSaveService.ts`): the WebView now lives in an app-root host so it outlives the screen.
 *
 * ⚠️ The arrow-head maths is duplicated here (a function cannot be shipped into a WebView); `arrowGeometry` in
 * `utils/annotation-shapes.ts` is the reference - change BOTH. This is a template literal: no backticks or `${`.
 * `imageIndex` is just an echo token; the service passes its request id through it.
 */
export const ANNOTATION_RENDER_HTML = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body, html { margin: 0; padding: 0; overflow: hidden; background: transparent; }
    canvas { display: none; }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>
  <script>
    document.addEventListener("message", function(event) {
      handleMessage(JSON.parse(event.data));
    });
    window.addEventListener("message", function(event) {
      handleMessage(JSON.parse(event.data));
    });

    async function handleMessage(data) {
      try {
        const canvas = document.getElementById("canvas");
        const ctx = canvas.getContext("2d");

        const img = new Image();
        img.onload = function() {
          // A very large scan overflows the WebView's canvas budget and toDataURL then returns an EMPTY "data:," - which
          // used to be uploaded as the photo / order sheet. The long side is capped (plenty for a page or a photo), and
          // every mark below is drawn in the scaled canvas's own units, so nothing else changes.
          const naturalW = img.naturalWidth || img.width;
          const naturalH = img.naturalHeight || img.height;
          const MAX_SIDE = 3600;
          const fit = Math.min(1, MAX_SIDE / Math.max(naturalW, naturalH));
          const w = Math.max(1, Math.round(naturalW * fit));
          const h = Math.max(1, Math.round(naturalH * fit));
          canvas.width = w;
          canvas.height = h;

          ctx.drawImage(img, 0, 0, w, h);

          // Ink is drawn on its OWN transparent layer and then laid over the photo: an eraser stroke
          // ('destination-out') on the photo canvas itself punched transparent holes in the PICTURE,
          // which a JPEG saves as black, instead of rubbing out only the pen marks as the preview does.
          if (data.strokes && data.strokes.length) {
            const layer = document.createElement('canvas');
            layer.width = w;
            layer.height = h;
            const lctx = layer.getContext('2d');
            data.strokes.forEach(stroke => {
              if (stroke.points.length === 0) return;

              lctx.beginPath();
              lctx.lineCap = 'round';
              lctx.lineJoin = 'round';

              if (stroke.isEraser) {
                lctx.globalCompositeOperation = 'destination-out';
                lctx.lineWidth = stroke.width * (w / data.layoutWidth);
              } else {
                lctx.globalCompositeOperation = 'source-over';
                lctx.strokeStyle = stroke.color;
                lctx.lineWidth = stroke.width * (w / data.layoutWidth);
              }

              const firstPoint = stroke.points[0];
              lctx.moveTo(firstPoint.px * w, firstPoint.py * h);

              stroke.points.forEach(pt => {
                lctx.lineTo(pt.px * w, pt.py * h);
              });

              lctx.stroke();
            });
            ctx.drawImage(layer, 0, 0);
          }

          // Shapes: same maths as utils/annotation-shapes.ts (arrowGeometry) - keep the two in step.
          if (data.shapes) {
            const sScale = w / data.layoutWidth;
            data.shapes.forEach(sh => {
              const x1 = sh.p1.px * w, y1 = sh.p1.py * h;
              const x2 = sh.p2.px * w, y2 = sh.p2.py * h;
              const lw = sh.width * sScale;
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              ctx.strokeStyle = sh.color;
              ctx.fillStyle = sh.color;
              ctx.lineWidth = lw;
              ctx.beginPath();
              if (sh.kind === 'line') {
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
              } else if (sh.kind === 'arrow') {
                const dx = x2 - x1, dy = y2 - y1;
                const len = Math.hypot(dx, dy) || 1;
                const ux = dx / len, uy = dy / len;
                const headLen = Math.min(Math.max(14 * sScale, lw * 4.5), len * 0.6);
                const bx = x2 - ux * headLen, by = y2 - uy * headLen;
                const half = headLen * Math.tan(Math.PI / 7);
                const shaft = headLen * 0.85;
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2 - ux * shaft, y2 - uy * shaft);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x2, y2);
                ctx.lineTo(bx - uy * half, by + ux * half);
                ctx.lineTo(bx + uy * half, by - ux * half);
                ctx.closePath();
                ctx.lineWidth = lw * 0.4;
                ctx.fill();
                ctx.stroke();
              } else if (sh.kind === 'circle') {
                const r = Math.hypot((sh.p2.px - sh.p1.px) * data.layoutWidth, (sh.p2.py - sh.p1.py) * data.layoutHeight) * sScale;
                ctx.arc(x1, y1, r, 0, Math.PI * 2);
                ctx.stroke();
              } else if (sh.kind === 'rect') {
                ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
                ctx.stroke();
              }
            });
          }

          ctx.globalCompositeOperation = 'source-over';

          if (data.texts) {
            data.texts.forEach(textObj => {
              const textScale = w / data.layoutWidth;
              const fontSize = textObj.fontSize * textScale;

              let fontStylePrefix = "";
              if (textObj.fontStyle === 'bold') {
                fontStylePrefix = "bold ";
              } else if (textObj.fontStyle === 'italic') {
                fontStylePrefix = "italic ";
              } else if (textObj.fontStyle === 'bold-italic') {
                fontStylePrefix = "italic bold ";
              }
              ctx.font = fontStylePrefix + fontSize + "px sans-serif";

              ctx.globalAlpha = textObj.opacity !== undefined ? textObj.opacity : 1.0;
              ctx.fillStyle = textObj.color || '#FFFFFF';
              ctx.fillText(textObj.text, textObj.px * w, textObj.py * h + fontSize * 0.8);
              ctx.globalAlpha = 1.0;
            });
          }

          const base64 = canvas.toDataURL("image/jpeg", 0.85);
          if (!base64 || base64.length < 2000 || base64.indexOf('data:image/jpeg;base64,') !== 0) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              status: 'error',
              imageIndex: data.imageIndex,
              message: 'Canvas export came back empty'
            }));
            return;
          }
          window.ReactNativeWebView.postMessage(JSON.stringify({
            status: 'success',
            imageIndex: data.imageIndex,
            base64: base64
          }));
        };
        img.onerror = function() {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            status: 'error',
            imageIndex: data.imageIndex,
            message: 'Image load failed'
          }));
        };
        img.src = data.backgroundImageBase64;
      } catch (e) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          status: 'error',
          imageIndex: data.imageIndex,
          message: e.message
        }));
      }
    }
  </script>
</body>
</html>

`;
