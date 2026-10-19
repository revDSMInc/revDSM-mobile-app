import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { ANNOTATION_RENDER_HTML } from '../../utils/annotation-render-html';
import {
  handleRenderHostMessage,
  markRenderHostReady,
  markRenderHostReloading,
  registerRenderHost,
} from '../../services/annotationRenderer';

const WebViewComponent = WebView as any;

/**
 * Mounted ONCE at the app root. Zero-size and invisible, it is the canvas `annotationRenderer` draws on, so saving an
 * annotated photo can finish after the annotation screen has already closed.
 */
export function AnnotationRenderHost() {
  const ref = useRef<any>(null);

  useEffect(
    () => registerRenderHost((json) => ref.current?.postMessage(json)),
    [],
  );

  return (
    <View pointerEvents="none" style={{ width: 0, height: 0, opacity: 0, position: 'absolute' }}>
      <WebViewComponent
        ref={ref}
        originWhitelist={['*']}
        source={{ html: ANNOTATION_RENDER_HTML }}
        onLoadStart={markRenderHostReloading}
        onLoadEnd={markRenderHostReady}
        onMessage={(e: any) => handleRenderHostMessage(e.nativeEvent.data)}
      />
    </View>
  );
}
