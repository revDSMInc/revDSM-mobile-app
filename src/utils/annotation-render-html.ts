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

          // One stroke on a context. Eraser = 'destination-out' (only meaningful on the transparent ink layer below).
          // Square eraser footprint (stroke.shape === 'square'; absent = round, drawn by the stroked branch below) = axis-aligned SQUARE swept along the stroke (hull of two squares per segment) - keep in step with eraserSweepPath in utils/annotation-brush.ts.
          function hullOf(pts) {
            pts.sort(function (a, b) { return a.x - b.x || a.y - b.y; });
            function cr(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
            var lo = [], up = [], i;
            for (i = 0; i < pts.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop(); lo.push(pts[i]); }
            for (i = pts.length - 1; i >= 0; i--) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], pts[i]) <= 0) up.pop(); up.push(pts[i]); }
            return lo.slice(0, -1).concat(up.slice(0, -1));
          }
          function eraseSquares(c, stroke) {
            var r = Math.max(stroke.width, 1) * (w / data.layoutWidth) / 2;
            function sq(p) {
              var x = p.px * w, y = p.py * h;
              return [{ x: x - r, y: y - r }, { x: x + r, y: y - r }, { x: x + r, y: y + r }, { x: x - r, y: y + r }];
            }
            c.globalCompositeOperation = 'destination-out';
            c.fillStyle = '#000';
            function fillPoly(poly) {
              c.beginPath();
              poly.forEach(function (q, k) { if (k === 0) c.moveTo(q.x, q.y); else c.lineTo(q.x, q.y); });
              c.closePath();
              c.fill();
            }
            if (stroke.points.length === 1) { fillPoly(sq(stroke.points[0])); return; }
            for (var k = 1; k < stroke.points.length; k++) fillPoly(hullOf(sq(stroke.points[k - 1]).concat(sq(stroke.points[k]))));
          }
          function drawStroke(c, stroke) {
            if (stroke.points.length === 0) return;
            if (stroke.isEraser && stroke.shape === 'square') { eraseSquares(c, stroke); return; }
            c.beginPath();
            c.lineCap = 'round';
            c.lineJoin = 'round';
            if (stroke.isEraser) {
              c.globalCompositeOperation = 'destination-out';
              c.lineWidth = stroke.width * (w / data.layoutWidth);
            } else {
              c.globalCompositeOperation = 'source-over';
              c.strokeStyle = stroke.color;
              c.lineWidth = stroke.width * (w / data.layoutWidth);
              // Pen transparency (REVUIUX-590). One stroke() call = one uniform alpha, so a stroke crossing itself does not darken.
              c.globalAlpha = (typeof stroke.opacity === 'number' && stroke.opacity > 0 && stroke.opacity <= 1) ? stroke.opacity : 1;
            }
            const firstPoint = stroke.points[0];
            c.moveTo(firstPoint.px * w, firstPoint.py * h);
            stroke.points.forEach(pt => {
              c.lineTo(pt.px * w, pt.py * h);
            });
            c.stroke();
            c.globalAlpha = 1;
          }

          // One shape on a context: same maths as utils/annotation-shapes.ts (arrowGeometry) - keep the two in step.
          function drawShape(c, sh) {
            const sScale = w / data.layoutWidth;
            const x1 = sh.p1.px * w, y1 = sh.p1.py * h;
            const x2 = sh.p2.px * w, y2 = sh.p2.py * h;
            const lw = sh.width * sScale;
            c.globalCompositeOperation = 'source-over';
            c.lineCap = 'round';
            c.lineJoin = 'round';
            c.strokeStyle = sh.color;
            c.fillStyle = sh.color;
            c.lineWidth = lw;
            c.beginPath();
            if (sh.kind === 'line') {
              c.moveTo(x1, y1);
              c.lineTo(x2, y2);
              c.stroke();
            } else if (sh.kind === 'arrow') {
              const dx = x2 - x1, dy = y2 - y1;
              const len = Math.hypot(dx, dy) || 1;
              const ux = dx / len, uy = dy / len;
              const headLen = Math.min(Math.max(14 * sScale, lw * 4.5), len * 0.6);
              const bx = x2 - ux * headLen, by = y2 - uy * headLen;
              const half = headLen * Math.tan(Math.PI / 7);
              const shaft = headLen * 0.85;
              c.moveTo(x1, y1);
              c.lineTo(x2 - ux * shaft, y2 - uy * shaft);
              c.stroke();
              c.beginPath();
              c.moveTo(x2, y2);
              c.lineTo(bx - uy * half, by + ux * half);
              c.lineTo(bx + uy * half, by - ux * half);
              c.closePath();
              c.lineWidth = lw * 0.4;
              c.fill();
              c.stroke();
            } else if (sh.kind === 'circle') {
              const r = Math.hypot((sh.p2.px - sh.p1.px) * data.layoutWidth, (sh.p2.py - sh.p1.py) * data.layoutHeight) * sScale;
              c.arc(x1, y1, r, 0, Math.PI * 2);
              c.stroke();
            } else if (sh.kind === 'rect') {
              c.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
              c.stroke();
            }
          }

          // Ink AND shapes are drawn on their OWN transparent layer, oldest first (data.order = [['s'|'h', index], ...] from
          // utils/annotation-layers.ts), then the layer is laid over the photo. An eraser stroke ('destination-out') therefore rubs
          // out only what was drawn BEFORE it - pen marks and shapes - and never punches holes in the PICTURE (a JPEG saves
          // those as black). Without data.order (an older caller) all ink goes first and the shapes after, as before.
          const order = Array.isArray(data.order)
            ? data.order
            : (data.strokes || []).map(function (_s, i) { return ['s', i]; }).concat((data.shapes || []).map(function (_s, i) { return ['h', i]; }));
          if (order.length) {
            const layer = document.createElement('canvas');
            layer.width = w;
            layer.height = h;
            const lctx = layer.getContext('2d');
            order.forEach(function (entry) {
              if (entry[0] === 's') {
                if (data.strokes && data.strokes[entry[1]]) drawStroke(lctx, data.strokes[entry[1]]);
              } else if (data.shapes && data.shapes[entry[1]]) {
                drawShape(lctx, data.shapes[entry[1]]);
              }
            });
            lctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(layer, 0, 0);
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
