import React, { useEffect, useRef } from 'react';
import RNFlashMessage from 'react-native-flash-message';
import { registerFlashHost } from '../../config/message';

interface Props {
  active?: boolean;
}

export function ModalFlashHost({ active = true }: Props) {
  const ref = useRef<RNFlashMessage>(null);

  useEffect(() => {
    if (!active) return;
    return registerFlashHost({
      show: (options) => {
        const instance = ref.current;
        if (!instance) return false;
        instance.showMessage(options);
        return true;
      },
    });
  }, [active]);

  if (!active) return null;

  return <RNFlashMessage ref={ref} position="top" canRegisterAsDefault={false} />;
}
