import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import MdiIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { iconifyToMdi } from '../components/lead-center/DynamicInspectionRenderer';

/**
 * Renders ANY Iconify icon dynamically, the way web does — so a schema icon is never
 * missed, no matter which icon set / name the backend supplies now or later.
 *
 * Web uses `@iconify/react`, which pulls the icon's SVG from the Iconify API. Mobile
 * has no such component, and MaterialCommunityIcons only covers a fraction of Iconify's
 * sets — which is why fixed name-mapping kept dropping icons (e.g. Flooring). So we
 * fetch the same SVG from the Iconify API (`api.iconify.design/{prefix}/{name}.svg`)
 * and draw it with react-native-svg. Multicolor sets (fluent-color, emojione…) keep
 * their native colours; monochrome sets are tinted via the `color` param — identical
 * to web. While the SVG loads (or offline, or if the icon truly doesn't exist) we fall
 * back to the closest MaterialCommunityIcons glyph so there's always something sensible.
 */

// name|color → resolved SVG xml, or null when the icon is unavailable. Shared across
// every instance so an icon is fetched once, then rendered instantly everywhere.
const svgCache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

const cacheKey = (name: string, color?: string) => `${name}|${color || ''}`;

function iconifyUrl(name: string, color?: string): string | null {
  const trimmed = name.trim();
  // Iconify names are "prefix:icon" → API path "prefix/icon". Without a set prefix we
  // can't address the API, so the caller uses the MDI fallback instead.
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
    // A miss returns the literal string "404" / "Not found", not an <svg> document.
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
  // Still loading → hold the space so the row doesn't reflow when the icon lands.
  if (!resolved) return <View style={{ width: size, height: size }} />;
  // Resolved with no SVG (offline / not found) → closest MDI glyph.
  const mdi = iconifyToMdi(name, '');
  return mdi ? <MdiIcon name={mdi} size={size} color={color} /> : null;
}
