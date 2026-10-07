import React, { useRef } from 'react';
import { ScrollView, View, type ScrollViewProps } from 'react-native';
import { useNumPadScrollIntoView } from '../../hooks/useNumPadScrollIntoView';

/**
 * A `ScrollView` that scrolls the focused numeric field clear of the in-app number pad
 * (`useNumPadScrollIntoView`). A component rather than a hook call in the screen because the
 * hook reads the NEAREST `NumPadProvider`, and a `Modal` has its own - so inside a modal the
 * hook must run below the `<Modal>`, which this does by living in the modal's tree.
 *
 * `contentTop` = the content container's top padding (see the hook).
 */
export function NumPadScrollView({
  children,
  contentTop = 0,
  ...rest
}: ScrollViewProps & { contentTop?: number }) {
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  useNumPadScrollIntoView(scrollRef, contentRef, contentTop);
  return (
    <ScrollView ref={scrollRef} {...rest}>
      <View ref={contentRef} collapsable={false}>
        {children}
      </View>
    </ScrollView>
  );
}
