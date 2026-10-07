import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import MdiIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { iconifyToMdi } from '../components/lead-center/DynamicInspectionRenderer';

const svgCache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

const cacheKey = (name: string, color?: string) => `${name}|${color || ''}`;

function iconifyUrl(name: string, color?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed.includes(':')) return null;
  const path = trimmed.replace(':', '/');
  return color
    ? `https://api.iconify.design/${path}.svg?color=${encodeURIComponent(color)}`
    : `https://api.iconify.design/${path}.svg`;
}

async function fetchSvg(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    return text && text.trim().startsWith('<svg') ? text : null;
  } catch {
    return null; // offline / DNS / timeout → fall back to MDI
  }
}

export function IconifyIcon({
  name,
  size = 18,
  color,
}: {
  name?: string | null;
  size?: number;
  color?: string;
}) {
  const key = name ? cacheKey(name, color) : '';
  const [xml, setXml] = useState<string | null>(() => (key ? svgCache.get(key) ?? null : null));
  const [resolved, setResolved] = useState<boolean>(() => (key ? svgCache.has(key) : false));

  useEffect(() => {
    if (!name) return;
    if (svgCache.has(key)) {
      setXml(svgCache.get(key) ?? null);
      setResolved(true);
      return;
    }
    const url = iconifyUrl(name, color);
    if (!url) {
      setResolved(true); // no set prefix → straight to MDI fallback
      return;
    }

    let cancelled = false;
    let promise = inFlight.get(key);
    if (!promise) {
      promise = fetchSvg(url);
      inFlight.set(key, promise);
    }
    promise.then((svg) => {
      svgCache.set(key, svg);
      inFlight.delete(key);
      if (!cancelled) {
        setXml(svg);
        setResolved(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [name, key, color]);

  if (!name) return null;
  if (xml) return <SvgXml xml={xml} width={size} height={size} />;
  if (!resolved) return <View style={{ width: size, height: size }} />;
  const mdi = iconifyToMdi(name, '');
  return mdi ? <MdiIcon name={mdi} size={size} color={color} /> : null;
}
