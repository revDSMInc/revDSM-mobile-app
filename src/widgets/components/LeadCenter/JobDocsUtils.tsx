import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  canAnnotateOrderSheet,
  serverWarningText,
  showResetAction,
} from '../../../utils/order-sheet-annotation';

const loadedUris = new Set<string>();

export const LoadingImage = React.memo(({ uri, style, resizeMode }: any) => {
  const [loading, setLoading] = useState(!loadedUris.has(uri));
  const { colors } = useTheme();

  return (
    <View style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
      {loading && (
        <View style={{ position: 'absolute', zIndex: 10, width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.05)' }}>
          <ActivityIndicator size="small" color={colors.primary.main} />
        </View>
      )}
      <Image
        source={{ uri }}
        style={[{ width: '100%', height: '100%' }, style]}
        resizeMode={resizeMode}
        onLoadStart={() => {
          if (!loadedUris.has(uri)) setLoading(true);
        }}
        onLoadEnd={() => {
          loadedUris.add(uri);
          setLoading(false);
        }}
        onError={() => setLoading(false)}
      />
    </View>
  );
});

export const DetailRow = ({ label, value, color, method, isDark }: any) => (
  <View className="flex-row justify-between items-center py-1">
    <Text className="text-[12px] text-gray-500 font-medium">{label}</Text>
    <View className="flex-row items-center">
      <Text
        className="text-[10px] font-black mr-2"
        style={{ color: color || (isDark ? '#FFFFFF' : '#1C252E') }}
      >
        {value}
      </Text>
      {method && (
        <View
          className="px-2 py-1 rounded-md border border-gray-100 shadow-sm"
          style={{
            backgroundColor: isDark ? '#1C252E' : '#FFFFFF',
            borderColor: isDark ? '#FFFFFF20' : '#E2E8F0',
            paddingHorizontal: 6,
            paddingVertical: 4,
          }}
        >
          <Text className="text-[10px] font-black text-gray-500 uppercase tracking-tighter">
            {method}
          </Text>
        </View>
      )}
    </View>
  </View>
);

export const DocumentItem = ({ doc, isDark, colors, onOpen, onImagePreview, onAnnotate, onReset }: any) => {
  const [opening, setOpening] = useState(false);
  // REVUIUX-569: the pencil / reset are order-sheet-only (the caller passes the handlers only for that list) and the rules for
  // WHEN they show live in `utils/order-sheet-annotation.ts`, where they are tested.
  const [annotating, setAnnotating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const syncing = !!doc.syncingAnnotation;
  const showPencil = !!onAnnotate && canAnnotateOrderSheet(doc);
  const showReset = !!onReset && showResetAction(doc);
  const handleAnnotate = async () => {
    if (annotating || syncing) return;
    setAnnotating(true);
    try {
      await onAnnotate?.(doc);
    } finally {
      setAnnotating(false);
    }
  };
  const handleReset = async () => {
    if (resetting || syncing) return;
    setResetting(true);
    try {
      await onReset?.(doc);
    } finally {
      setResetting(false);
    }
  };
  const isImage = doc.uri?.toLowerCase().match(/\.(jpg|jpeg|png|webp|heic)$/) || !doc.uri?.toLowerCase().includes('.pdf');

  const handlePress = async () => {
    if (opening) return;
    setOpening(true);
    try {
      if (isImage) {
        await onImagePreview?.(doc.uri);
      } else {
        await onOpen?.(doc.uri, doc.name);
      }
    } finally {
      setTimeout(() => setOpening(false), 800);
    }
  };

  // ⚠️ The row is a plain View with SEPARATE touch targets. It used to be one TouchableOpacity; a pencil nested inside it would
  // also have fired the preview.
  return (
    <View
      className="p-4 bg-gray-50 rounded-2xl border border-gray-100"
      style={{ backgroundColor: isDark ? '#FFFFFF08' : '#F9FAFB' }}
    >
      <View className="flex-row items-center justify-between">
        <TouchableOpacity onPress={handlePress} activeOpacity={0.7} className="flex-row items-center gap-3" style={{ flex: 1 }}>
          <View className={`p-2 rounded-lg ${isImage ? 'bg-blue-50' : 'bg-red-50'}`}>
            <Icon
              name={isImage ? "image-outline" : "file-pdf-box"}
              size={24}
              color={isImage ? "#2196F3" : "#FF5630"}
            />
          </View>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text
              className="text-xs font-bold text-[#1C252E]"
              style={{ color: colors.text }}
              numberOfLines={1}
            >
              {doc.name}
            </Text>
            <Text className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-0.5">
              {isImage ? 'IMAGE' : 'PDF'} • {(doc.size !== undefined && doc.size !== null) ? (doc.size / 1024).toFixed(0) + ' KB' : 'Size N/A'}
            </Text>
            {/* Signed offline and still in the upload queue. It opens from the local file, so the
                rep can show it to the customer - this only says it has not reached the server. */}
            {doc.pendingUpload && (
              <View className="flex-row items-center gap-1 mt-1">
                <Icon name="cloud-upload-outline" size={11} color="#B76E00" />
                <Text className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#B76E00' }}>
                  Saved on device - uploads when online
                </Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
        <View className="flex-row items-center" style={{ gap: 16 }}>
          {showPencil && (
            annotating ? (
              <ActivityIndicator size="small" color={colors.primary.main} />
            ) : (
              <TouchableOpacity
                onPress={handleAnnotate}
                disabled={syncing}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }}
                accessibilityLabel="Annotate order sheet"
                style={{ opacity: syncing ? 0.35 : 1 }}
              >
                {/* A distinct glyph: three other pencils nearby already mean "edit contract", "scan a document" and
                    "annotate photos", and a fourth plain one would be read as one of those. */}
                <Icon name="pencil-ruler" size={21} color="#637381" />
              </TouchableOpacity>
            )
          )}
          <TouchableOpacity onPress={handlePress} hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }} accessibilityLabel="View document">
            {opening ? (
              <ActivityIndicator size="small" color={colors.primary.main} />
            ) : (
              <Icon name="eye-outline" size={20} color="#637381" />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {syncing && (
        <View className="flex-row items-center gap-1 mt-2">
          <ActivityIndicator size="small" color="#B76E00" />
          <Text className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#B76E00' }}>
            Syncing annotation - saved on this device
          </Text>
        </View>
      )}

      {/* A warning the SERVER attached to this sheet, shown exactly as sent. The app adds no warning text of its own. */}
      {!!serverWarningText(doc) && (
        <View className="flex-row items-start gap-1.5 mt-2">
          <Icon name="alert-circle-outline" size={14} color="#B71D18" />
          <Text className="text-[11px] font-bold flex-1" style={{ color: '#B71D18' }}>
            {serverWarningText(doc)}
          </Text>
        </View>
      )}

      {showReset && (
        <TouchableOpacity
          onPress={handleReset}
          disabled={syncing || resetting}
          className="flex-row items-center gap-1.5 mt-2"
          style={{ alignSelf: 'flex-start', opacity: syncing ? 0.35 : 1 }}
          accessibilityLabel="Reset all changes"
        >
          {resetting ? <ActivityIndicator size="small" color="#B76E00" /> : <Icon name="restore" size={14} color="#B76E00" />}
          <Text className="text-[11px] font-black" style={{ color: '#B76E00' }}>
            Reset all changes
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};
