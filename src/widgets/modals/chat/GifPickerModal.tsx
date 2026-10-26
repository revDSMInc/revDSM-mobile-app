import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useBottomInset } from '../../../hooks/useBottomInset';
import { useGifSearch } from '../../../hooks/useGifSearch';
import type { GifItem } from '../../../services/api/giphy';

const COLUMNS = 3;
const GAP = 2;
const SHEET_BG = '#1C1C1E';
const FIELD_BG = '#2C2C2E';
const MUTED = 'rgba(255,255,255,0.55)';

interface GifPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (gif: GifItem) => void;
}

const GifCell = React.memo(function GifCellView({
  gif,
  size,
  onPress,
}: {
  gif: GifItem;
  size: number;
  onPress: (g: GifItem) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(gif)}
      accessibilityRole="button"
      accessibilityLabel={gif.title || 'GIF'}
      style={{ width: size, height: size, backgroundColor: FIELD_BG }}
    >
      <Image source={{ uri: gif.previewUrl }} style={{ width: size, height: size }} resizeMode="cover" />
    </Pressable>
  );
});

const GifRowGap = () => <View style={{ height: GAP }} />;

export const GifPickerModal = ({ visible, onClose, onSelect }: GifPickerModalProps) => {
  const [query, setQuery] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const { width, height } = useWindowDimensions();
  const bottomInset = useBottomInset();
  const { items, isLoading, isError, isFetchingMore, loadMore, refetch, configured } = useGifSearch(
    query,
    visible
  );

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setKeyboardHeight(0);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => setKeyboardHeight(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [visible]);

  const handleSelect = useCallback(
    (gif: GifItem) => {
      Keyboard.dismiss();
      onSelect(gif);
    },
    [onSelect]
  );

  const cell = Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS);
  // Capped by the remaining height too (iPad landscape), and kept above the keyboard.
  const sheetHeight = Math.min(height * 0.88, height - 60);
  const lift = Math.max(keyboardHeight - bottomInset, 0);

  const renderEmpty = () => {
    if (!configured) {
      return <Notice icon="key-outline" text="GIFs are not set up yet. Add GIPHY_API_KEY to the app's .env file." />;
    }
    if (isLoading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
        </View>
      );
    }
    if (isError) {
      return <Notice icon="cloud-offline-outline" text="Couldn't load GIFs." action="Try again" onAction={refetch} />;
    }
    return <Notice icon="search-outline" text={query.trim() ? `No GIFs found for “${query.trim()}”.` : 'No GIFs to show.'} />;
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={StyleSheet.absoluteFill}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close GIF picker" />
        <View
          style={[
            styles.sheet,
            { height: sheetHeight, marginBottom: lift },
          ]}
        >
          <View style={styles.handle} />
          <View style={styles.searchRow}>
            <Icon name="search" size={20} color={MUTED} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search GIFs"
              placeholderTextColor={MUTED}
              style={styles.input}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            {Platform.OS === 'android' && query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={10}>
                <Icon name="close-circle" size={18} color={MUTED} />
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={items}
            keyExtractor={(g) => g.id}
            numColumns={COLUMNS}
            columnWrapperStyle={{ gap: GAP }}
            ItemSeparatorComponent={GifRowGap}
            renderItem={({ item }) => <GifCell gif={item} size={cell} onPress={handleSelect} />}
            onEndReached={loadMore}
            onEndReachedThreshold={0.6}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{
              flexGrow: 1,
              paddingBottom: (lift > 0 ? 0 : bottomInset) + 8,
            }}
            ListEmptyComponent={renderEmpty}
            ListFooterComponent={
              isFetchingMore ? <ActivityIndicator color="#fff" style={{ paddingVertical: 16 }} /> : null
            }
            removeClippedSubviews
            initialNumToRender={12}
            windowSize={7}
          />

          <Text style={[styles.attribution, { paddingBottom: lift > 0 ? 6 : Math.max(bottomInset, 6) }]}>
            Powered by GIPHY
          </Text>
        </View>
      </View>
    </Modal>
  );
};

const Notice = ({
  icon,
  text,
  action,
  onAction,
}: {
  icon: string;
  text: string;
  action?: string;
  onAction?: () => void;
}) => (
  <View style={styles.center}>
    <Icon name={icon} size={32} color={MUTED} />
    <Text style={styles.noticeText}>{text}</Text>
    {!!action && (
      <TouchableOpacity onPress={onAction} style={styles.retry}>
        <Text style={styles.retryText}>{action}</Text>
      </TouchableOpacity>
    )}
  </View>
);

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 46,
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 10,
    paddingHorizontal: 14,
    borderRadius: 23,
    backgroundColor: FIELD_BG,
  },
  input: {
    flex: 1,
    marginLeft: 10,
    paddingVertical: 0,
    fontSize: 16,
    color: '#fff',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
  noticeText: { marginTop: 10, color: MUTED, fontSize: 14, textAlign: 'center' },
  retry: {
    marginTop: 14,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: FIELD_BG,
  },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  attribution: {
    textAlign: 'center',
    paddingTop: 6,
    fontSize: 11,
    color: MUTED,
    backgroundColor: SHEET_BG,
  },
});
