import React from 'react';
import { Modal, View } from 'react-native';

type Props = {
  visible: boolean;
  onRequestClose?: () => void;
  children: React.ReactNode;
  animationType?: 'none' | 'slide' | 'fade';
  transparent?: boolean;
};

export function OverlayModal({
  visible,
  onRequestClose,
  children,
  animationType = 'fade',
  transparent = true,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent={transparent}
      animationType={animationType}
      onRequestClose={onRequestClose}
    >
      <View className="flex-1 bg-black/50 justify-center items-center">{children}</View>
    </Modal>
  );
}
