import React, { useMemo } from 'react';
import { Image, View } from 'react-native';
import Svg, { Circle, G, Line, Mask, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { arrowGeometry, circleRadiusPx } from '../../../utils/annotation-shapes';
import { eraserSweepPath, strokeOpacity } from '../../../utils/annotation-brush';
import { layerBlocks, orderedLayers } from '../../../utils/annotation-layers';
import { coverBox, type PendingAnnotationJobView } from '../../../utils/pending-annotations';

interface Props {
  job: PendingAnnotationJobView;
  width: number;
  height: number;
}

const pathOf = (points: { px: number; py: number }[], W: number, H: number): string => {
  if (!points.length) return '';
  const [first, ...rest] = points;
  let d = `M ${first.px * W} ${first.py * H}`;
  if (!rest.length) return `${d} L ${first.px * W + 0.1} ${first.py * H}`;
  rest.forEach((p) => {
    d += ` L ${p.px * W} ${p.py * H}`;
  });
  return d;
};

/**
 * What a just-saved annotated photo looks like BEFORE its JPEG has been flattened: the original with the rep's marks
 * drawn over it, cropped exactly like the card's "cover" thumbnail. Drawn in the editor's own layout space through a
 * viewBox, so stroke widths and font sizes scale the same way the final render scales them.
 */
export function AnnotationOverlayPreview({ job, width, height }: Props) {
  const lw = job.layoutWidth || width;
  const lh = job.layoutHeight || height;
  const box = useMemo(() => coverBox(width, height, lw, lh), [width, height, lw, lh]);

  const maskId = 'pending-annotation-eraser';
  const blocks = useMemo(() => layerBlocks(orderedLayers(job.strokes, job.shapes)), [job.strokes, job.shapes]);

  const renderShape = (sh: any, i: number) => {
    const x1 = sh.p1.px * lw;
    const y1 = sh.p1.py * lh;
    const x2 = sh.p2.px * lw;
    const y2 = sh.p2.py * lh;
    const common = { stroke: sh.color, strokeWidth: sh.width, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
    switch (sh.kind) {
      case 'line':
        return <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} {...common} />;
      case 'arrow': {
        const g = arrowGeometry(x1, y1, x2, y2, sh.width);
        return (
          <G key={i}>
            <Line x1={x1} y1={y1} x2={g.shaftEnd.x} y2={g.shaftEnd.y} {...common} />
            <Polygon
              points={`${g.tip.x},${g.tip.y} ${g.left.x},${g.left.y} ${g.right.x},${g.right.y}`}
              fill={sh.color}
              stroke={sh.color}
              strokeWidth={sh.width * 0.4}
              strokeLinejoin="round"
            />
          </G>
        );
      }
      case 'circle':
        return <Circle key={i} cx={x1} cy={y1} r={circleRadiusPx(sh, lw, lh)} fill="none" {...common} />;
      case 'rect':
        return (
          <Rect
            key={i}
            x={Math.min(x1, x2)}
            y={Math.min(y1, y2)}
            width={Math.abs(x2 - x1)}
            height={Math.abs(y2 - y1)}
            fill="none"
            {...common}
          />
        );
      default:
        return null;
    }
  };

  // Chronological layers (utils/annotation-layers.ts): an eraser stroke rubs out the ink AND shapes drawn before it, like the editor and the saved JPEG.
  const renderLayers = () => {
    let content: React.ReactNode[] = [];
    blocks.forEach((blk, bi) => {
      if (blk.erasers.length) {
        const id = `${maskId}-${bi}`;
        content = [
          <Mask key={`m-${bi}`} id={id}>
            <Rect x={0} y={0} width={lw} height={lh} fill="white" />
            {blk.erasers.map((s, i) => (
              s.shape === 'square' ? (
                <Path key={i} d={eraserSweepPath(s.points, lw, lh, s.width)} fill="black" />
              ) : (
                <Path key={i} d={pathOf(s.points, lw, lh)} stroke="black" strokeWidth={s.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              )
            ))}
          </Mask>,
          <G key={`g-${bi}`} mask={`url(#${id})`}>
            {content}
          </G>,
        ];
      }
      blk.items.forEach((l, i) => {
        content.push(
          l.kind === 'stroke' ? (
            <Path
              key={`s-${bi}-${i}`}
              d={pathOf(l.item.points, lw, lh)}
              stroke={l.item.color}
              strokeWidth={l.item.width}
              strokeOpacity={strokeOpacity(l.item)}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <G key={`h-${bi}-${i}`}>{renderShape(l.item, i)}</G>
          ),
        );
      });
    });
    return content;
  };

  return (
    <View style={{ width, height, overflow: 'hidden', backgroundColor: '#16302A' }}>
      <Image
        source={{ uri: job.originalUri }}
        style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }}
        resizeMode="cover"
      />
      <Svg
        style={{ position: 'absolute', left: box.x, top: box.y }}
        width={box.w}
        height={box.h}
        viewBox={`0 0 ${lw} ${lh}`}
        pointerEvents="none"
      >
        {renderLayers()}
        {(job.texts || []).map((t, i) => {
          const fontSize = t.fontSize || 16;
          return (
            <SvgText
              key={i}
              x={t.px * lw}
              y={t.py * lh + fontSize * 0.8}
              fontSize={fontSize}
              fill={t.color || '#FFFFFF'}
              fillOpacity={t.opacity !== undefined ? t.opacity : 1}
              fontWeight={t.fontStyle === 'bold' || t.fontStyle === 'bold-italic' ? 'bold' : 'normal'}
              fontStyle={t.fontStyle === 'italic' || t.fontStyle === 'bold-italic' ? 'italic' : 'normal'}
            >
              {t.text}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
}
