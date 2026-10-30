import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Alert,
  Platform,
  Dimensions,
  Clipboard,
  Modal,
  Vibration,
  ActivityIndicator,
  Pressable,
  ToastAndroid,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Ionicons';
import Fontisto from 'react-native-vector-icons/Fontisto';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

import { useTheme } from '../../../theme/ThemeProvider';
import { MediaViewerModal } from '../../modals/MediaViewerModal';
import { ImageGalleryModal } from '../../modals/ImageGalleryModal';
import { REACTION_EMOJIS, MORE_EMOJIS } from './chat-constants';
import { ACK_AMBER, ACK_GREEN } from './chat-confirmation';
import { ENV } from '../../../config/env';
import { getFileType, getAvatarProps, getNativeModules, cleanFilePath } from './chat-utils';
import { VoiceNotePlayer } from './VoiceNotePlayer';
import { DownloadProgressRing } from './DownloadProgressRing';
import { ChatMessageText } from './ChatMessageText';
import { GifMessage } from './GifMessage';
import { GIF_REPLY_LABEL, isGifFileMessage, isGifMessageText } from '../../../utils/gif-message';
import { ScrollView } from 'react-native-gesture-handler';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const MAX_BUBBLE_WIDTH = SCREEN_WIDTH * 0.75;
// A stored GIF's bubble is sized from the GIF (GifMessage draws min(maxWidth, 240)) + 8 padding each side (p-2) + 2 bubble padding each side + 1 border each side.
const GIF_WIDTH = Math.min(MAX_BUBBLE_WIDTH - 40, 240);
const GIF_BUBBLE_WIDTH = GIF_WIDTH + 22;

const getDocStyleAndIcon = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'pdf':
      return {
        icon: 'acrobat-reader',
        color: '#FF3B30',
        bg: 'bg-[#FF3B30]',
      };
    case 'xls':
    case 'xlsx':
    case 'csv':
      return {
        icon: 'microsoft-excel',
        color: '#34C759',
        bg: 'bg-[#34C759]',
      };
    case 'doc':
    case 'docx':
      return {
        icon: 'document-text',
        color: '#007AFF',
        bg: 'bg-[#007AFF]',
      };
    case 'ppt':
    case 'pptx':
      return {
        icon: 'easel',
        color: '#FF9500',
        bg: 'bg-[#FF9500]',
      };
    case 'zip':
    case 'rar':
    case '7z':
      return {
        icon: 'archive',
        color: '#8E8E93',
        bg: 'bg-[#8E8E93]',
      };
    default:
      return {
        icon: 'document',
        color: '#007AFF',
        bg: 'bg-blue-500',
      };
  }
};

const GridImageCell = React.memo(function GridImageCell({
  src,
  label,
  overlayText,
  w,
  h,
  isDark,
  spinnerColor,
  labelColor,
  onPress,
  onLongPress,
}: {
  src: string;
  label: string;
  overlayText?: string;
  w: number;
  h: number;
  isDark: boolean;
  spinnerColor: string;
  labelColor: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <View style={{ width: w }}>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        onLongPress={onLongPress}
        style={{
          width: w,
          height: h,
          borderRadius: 8,
          overflow: 'hidden',
          backgroundColor: isDark ? '#1B2B34' : '#F2F2F7',
        }}
      >
        {src ? (
          <Image
            source={{ uri: src, cache: 'force-cache' }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="small" color={spinnerColor} />
          </View>
        )}
        {!!overlayText && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.55)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 26 }}>{overlayText}</Text>
          </View>
        )}
      </TouchableOpacity>
      {!!label && (
        <Text
          numberOfLines={1}
          style={{
            fontSize: 12,
            fontWeight: '900',
            marginTop: 4,
            textAlign: 'center',
            color: labelColor,
          }}
        >
          {label}
        </Text>
      )}
    </View>
  );
});

interface Props {
  bubbleProps: any;
  currentUserId: string;
  participants?: any[];
  onReply: (msg: any) => void;
  onEdit: (msg: any) => void;
  onReact: (msg: any, emoji: string) => void;
  onPin?: (msg: any) => void;
  onViewHistory: (msg: any) => void;
  onNavigateToMessage?: (msg: any) => void;
  onDelete: (msgId: string) => void;
  imageUrls: Record<string, string>;
  isViewOnly?: boolean;
  canReply?: boolean;
  canReact?: boolean;
  canEditOwn?: boolean;
  onDisabledClick?: () => void;
  searchQuery?: string;
  activeMatchId?: string | null;
  onLayout?: (event: any) => void;
  /** REVDSM-1313 read confirmation: tint + header the ack-required message carries. */
  ackRequired?: 'pending' | 'confirmed' | null;
}

export const ChatMessageBubble = React.memo(function ChatMessageBubble({
  bubbleProps,
  currentUserId,
  participants = [],
  onReply,
  onEdit,
  onReact,
  onPin,
  onViewHistory,
  onNavigateToMessage,
  onDelete,
  onLayout,
  imageUrls,
  isViewOnly = false,
  canReply = true,
  canReact = true,
  canEditOwn = true,
  onDisabledClick,
  searchQuery,
  activeMatchId,
  ackRequired = null,
}: Props) {
  const { colors, isDark } = useTheme();
  const { currentMessage, previousMessage } = bubbleProps;
  const msg = currentMessage as any;
  const position = bubbleProps.position || (String(msg.user?._id) === String(currentUserId) ? 'right' : 'left');
  const isMe = position === 'right';
  const isPinned = msg.isPinned || false;

  // Read confirmation (REVDSM-1313): amber while the read is still open, green once it is settled.
  // The manager's own message keeps its green bubble — only the header restyles over it.
  const ackPalette = ackRequired === 'pending' ? ACK_AMBER : ACK_GREEN;
  const ackUi = !ackRequired
    ? null
    : isMe
      ? {
          bg: null as string | null,
          border: null as string | null,
          label: 'rgba(255,255,255,0.95)',
          stripBg: 'rgba(0,0,0,0.08)',
          stripBorder: 'rgba(255,255,255,0.25)',
          icon: ackRequired === 'pending' ? 'checkmark-circle-outline' : 'checkmark-circle',
        }
      : {
          bg: isDark ? ackPalette.dark.bg : ackPalette.light.bg,
          border: isDark ? ackPalette.dark.border : ackPalette.light.border,
          label: isDark ? ackPalette.dark.accent : ackPalette.light.accent,
          stripBg: 'transparent',
          stripBorder: isDark ? ackPalette.dark.border : ackPalette.light.border,
          icon: ackRequired === 'pending' ? 'checkmark-circle-outline' : 'checkmark-circle',
        };

  const isSameUser = (m1: any, m2: any) => m1?.user?._id === m2?.user?._id;

  const files = msg.files || [];
  const primaryFile = files[0];

  const fileType = useMemo(() => {
    const fromUtils = getFileType(primaryFile);
    if (fromUtils !== 'text' && fromUtils !== 'file') return fromUtils;

    if (!primaryFile) {
      if (msg.image || msg.imageUrl) return 'image';
      if (msg.video || msg.videoUrl) return 'video';
      if (msg.voice || msg.audio || msg.voiceUrl || msg.audioUrl) return 'audio';
      return 'text';
    }
    const type = (
      primaryFile.type ||
      primaryFile.mimeType ||
      primaryFile.contentType ||
      ''
    ).toLowerCase();
    if (type.startsWith('image') || msg.image || msg.imageUrl) return 'image';
    if (type.startsWith('video') || msg.video || msg.videoUrl) return 'video';
    if (
      type.startsWith('audio') ||
      type.includes('voice') ||
      msg.voice ||
      msg.audio ||
      msg.voiceUrl ||
      msg.audioUrl
    )
      return 'audio';
    return fromUtils || 'file';
  }, [primaryFile, msg.image, msg.video, msg.voice, msg.audio]);

  const voiceUri = useMemo(() => {
    return (
      msg.audio ||
      msg.voice ||
      msg.audioUrl ||
      msg.voiceUrl ||
      (fileType === 'audio' ? primaryFile?.url || primaryFile?.path || primaryFile?.filePath : null)
    );
  }, [msg.audio, msg.voice, fileType, primaryFile]);



  const mediaUri = useMemo(() => {
    const localUri = [primaryFile?.url, msg.image, msg.imageUrl, msg.video, msg.videoUrl].find(
      (u) => typeof u === 'string' && u.startsWith('file://')
    );
    const raw =
      localUri ||
      primaryFile?.filePath ||
      primaryFile?.path ||
      primaryFile?.url ||
      msg.image ||
      msg.imageUrl ||
      msg.video ||
      msg.videoUrl;
    if (!raw || typeof raw !== 'string') {
      if (typeof primaryFile?.previewUrl === 'string' && /^https?:\/\//.test(primaryFile.previewUrl)) {
        return primaryFile.previewUrl;
      }
      return '';
    }
    const idKey = (primaryFile as any)?.id || (primaryFile as any)?._id;
    let resolved = (idKey && imageUrls[idKey]) || imageUrls[raw] || imageUrls[cleanFilePath(raw)];
    if (
      !resolved &&
      typeof primaryFile?.previewUrl === 'string' &&
      /^https?:\/\//.test(primaryFile.previewUrl)
    ) {
      resolved = primaryFile.previewUrl;
    }
    if (!resolved && typeof primaryFile?.url === 'string' && /^https?:\/\//.test(primaryFile.url)) {
      resolved = primaryFile.url; // web parity: optimistic file carries the signed URL in `url`
    }
    if (!resolved) resolved = raw;
    if (resolved && !resolved.startsWith('http://') && !resolved.startsWith('https://') && !resolved.startsWith('file://')) {
      resolved = `${ENV.API_URL}${resolved.startsWith('/') ? resolved.slice(1) : resolved}`;
    }
    return resolved;
  }, [primaryFile, msg.image, msg.imageUrl, msg.video, msg.videoUrl, imageUrls]);

  // A picked GIF is stored in S3 like a photo, so it arrives as a lone GIF
  // attachment rather than a GIPHY URL in the body; it renders in the same
  // inline bubble, from the signed URL `mediaUri` already resolved. Until that
  // URL is in hand there is nothing to animate, and the photo branch shows its
  // own placeholder.
  const gifUri = useMemo(() => {
    if (!isGifFileMessage(msg) || !/^(https?|file):/.test(mediaUri)) return '';
    return mediaUri;
  }, [msg, mediaUri]);

  const imageFiles = useMemo(() => {
    return files.filter((f: any) => {
      if (!f) return false;
      if (f.isAppointmentPhoto) return true;
      const t = (f.type || f.mimeType || f.contentType || '').toLowerCase();
      if (t.startsWith('image')) return true;
      return getFileType(f) === 'image';
    });
  }, [files]);

  const getGridSrc = (f: any): string => {
    const idKey = f?.id || f?._id;
    const byId = idKey ? imageUrls[idKey] : undefined;
    if (byId) return byId;
    const fp = f?.filePath || f?.path;
    const signed = fp ? imageUrls[fp] || imageUrls[cleanFilePath(fp)] : undefined;
    if (signed) return signed;
    if (typeof f?.previewUrl === 'string' && /^https?:\/\//.test(f.previewUrl)) return f.previewUrl;
    if (typeof f?.url === 'string' && /^https?:\/\//.test(f.url)) return f.url;
    const local = [f?.url, f?.uri].find(
      (u: any) => typeof u === 'string' && (u.startsWith('file://') || u.startsWith('content://'))
    );
    return (local as string) || '';
  };

  const getPhotoLabel = (f: any): string => {
    const isAppt =
      f?.isAppointmentPhoto ||
      !!f?.subcategory ||
      !!f?.category ||
      (f?.filePath || f?.path || '').includes('SelfGen');
    if (!isAppt) return '';
    const raw = f?.subcategory || f?.category || f?.fileName || f?.name || '';
    return String(raw).replace(/\.[^/.]+$/, '').trim();
  };

  const isMsgVoice = !!voiceUri || msg.isVoiceNote || msg.type === 'audio' || fileType === 'audio';

  const secureVoiceUri = useMemo(() => {
    if (!voiceUri) return '';
    let secure = imageUrls[voiceUri] || imageUrls[cleanFilePath(voiceUri)] || voiceUri;
    if (secure && !secure.startsWith('http://') && !secure.startsWith('https://') && !secure.startsWith('file://')) {
      secure = `${ENV.API_URL}${secure.startsWith('/') ? secure.slice(1) : secure}`;
    }
    if (isMsgVoice) {
      console.log('[ChatMessageBubble] Voice URI resolved Full:', secure);
    }
    return secure;
  }, [voiceUri, imageUrls, isMsgVoice]);

  // A GIF message is a text message whose body is a GIPHY url: never show that url, copy it or edit it.
  // (A GIF the server stored carries no url to leak — it is a file, so the `fileType === 'text'` guards on
  // Copy and Edit already hide both — but the long-press preview still has to show the picture.)
  const isGifMsg = isGifMessageText(msg.text);
  const gifPreviewUri = isGifMsg ? msg.text.trim() : gifUri;

  const hasTextOrFiles = useMemo(() => {
    return !!((msg.text && msg.text.trim().length > 0) || files.length > 0 || isMsgVoice);
  }, [msg.text, files, isMsgVoice]);

  const [showHistory, setShowHistory] = useState(false);
  const [showReactionList, setShowReactionList] = useState(false);
  const [showSeenList, setShowSeenList] = useState(false);
  const [selectedEmojiTab, setSelectedEmojiTab] = useState('All');
  const [showReactionBar, setShowReactionBar] = useState(false);
  const [showFullEmojiPicker, setShowFullEmojiPicker] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerUri, setViewerUri] = useState('');
  const [viewerType, setViewerType] = useState<'image' | 'video'>('image');
  const [localFilePath, setLocalFilePath] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState(1);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

  const galleryImages = useMemo(
    () => imageFiles.map((f: any) => ({ uri: getGridSrc(f), label: getPhotoLabel(f) })),
    [imageFiles, imageUrls]
  );

  useEffect(() => {
    if (fileType === 'image' && mediaUri) {
      Image.getSize(mediaUri, (w, h) => {
        if (w && h) setImageAspectRatio(w / h);
      }, () => { });
    }
  }, [mediaUri, fileType]);

  useEffect(() => {
    const checkFile = async () => {
      if (!primaryFile) return;
      const { ReactNativeBlobUtil } = getNativeModules();
      if (!ReactNativeBlobUtil) return;
      const name =
        primaryFile.name ||
        cleanFilePath(primaryFile.filePath || '')
          .split('/')
          .pop();
      const privatePath = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/revdsm_chat/${name}`;
      if (await ReactNativeBlobUtil.fs.exists(privatePath)) {
        setLocalFilePath(privatePath);
        return;
      }
      const downloadDir =
        Platform.OS === 'android'
          ? ReactNativeBlobUtil.fs.dirs.DownloadDir
          : ReactNativeBlobUtil.fs.dirs.DocumentDir;
      const publicPath = `${downloadDir}/${name}`;
      if (await ReactNativeBlobUtil.fs.exists(publicPath)) {
        setLocalFilePath(publicPath);
      }
    };
    checkFile();
  }, [primaryFile]);

  const handleMediaPress = (type: 'image' | 'video') => {
    if (mediaUri) {
      setViewerUri(
        localFilePath
          ? Platform.OS === 'android'
            ? `file://${localFilePath}`
            : localFilePath
          : mediaUri
      );
      setViewerType(type);
      setViewerVisible(true);
    }
  };

  const saveFileToDevice = async () => {
    if (isDownloading) return;
    if (!mediaUri) return Alert.alert('Error', 'Link loading...');
    const { ReactNativeBlobUtil } = getNativeModules();
    if (!ReactNativeBlobUtil) return Alert.alert('Error', 'Native rebuild needed.');

    try {
      setIsDownloading(true);
      setDownloadProgress(0);
      const name = primaryFile?.name || `file_${Date.now()}`;
      const downloadDir =
        Platform.OS === 'android'
          ? ReactNativeBlobUtil.fs.dirs.DownloadDir
          : ReactNativeBlobUtil.fs.dirs.DocumentDir;
      const path = `${downloadDir}/${name}`;

      await ReactNativeBlobUtil.config({
        path,
        fileCache: true,
        addAndroidDownloads: {
          useDownloadManager: true,
          notification: true,
          path,
          description: 'Downloading file...',
          mime: primaryFile?.mimeType || 'application/octet-stream',
          mediaScannable: true,
        },
      })
        .fetch('GET', mediaUri)
        .progress((r: number, t: number) => {
          if (t > 0) setDownloadProgress(r / t);
        });

      setIsDownloading(false);
      setLocalFilePath(path);
      Alert.alert(
        'Success',
        `File saved to ${Platform.OS === 'android' ? 'Downloads' : 'Documents'} folder.`
      );
      setShowReactionBar(false);
    } catch (err) {
      setIsDownloading(false);
      Alert.alert('Error', 'Failed to save file.');
    }
  };

  const handleOpenOrDownload = async () => {
    if (isDownloading) return;
    const { ReactNativeBlobUtil, FileViewer } = getNativeModules();
    if (localFilePath) {
      if (FileViewer) {
        try {
          await FileViewer.open(localFilePath, { showOpenWithDialog: true });
        } catch (e) {
          Alert.alert('Unsupported File', 'No app found to open this file.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Save to Device', onPress: saveFileToDevice },
          ]);
        }
      }
      return;
    }
    if (!mediaUri) return Alert.alert('Error', 'Link loading...');
    if (!ReactNativeBlobUtil) return Alert.alert('Error', 'Native rebuild needed.');

    try {
      setIsDownloading(true);
      setDownloadProgress(0);
      const name = primaryFile?.name || `file_${Date.now()}`;
      const path = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/revdsm_chat/${name}`;
      const dir = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/revdsm_chat`;
      if (!(await ReactNativeBlobUtil.fs.exists(dir))) await ReactNativeBlobUtil.fs.mkdir(dir);

      const res = await ReactNativeBlobUtil.config({ path, fileCache: true })
        .fetch('GET', mediaUri, {
          'Accept-Encoding': 'identity',
        })
        .progress((r: number, t: number) => {
          if (t > 0) setDownloadProgress(r / t);
        });
      const downloadedPath = res.path();
      setLocalFilePath(downloadedPath);
      setIsDownloading(false);

      if (FileViewer) {
        try {
          await FileViewer.open(downloadedPath, { showOpenWithDialog: true });
        } catch (e) {
          Alert.alert('Unsupported File', 'No app found to open this file.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Save to Device', onPress: saveFileToDevice },
          ]);
        }
      }
    } catch (err) {
      setIsDownloading(false);
      Alert.alert('Error', 'Download failed.');
    }
  };

  const handleCopy = () => {
    if (msg.text) {
      Clipboard.setString(msg.text);
      if (Platform.OS === 'android') {
        ToastAndroid.show('Message copied to clipboard', ToastAndroid.SHORT);
      } else {
        Alert.alert('Copied', 'Message copied to clipboard');
      }
      setShowReactionBar(false);
    }
  };
  const msgRef = useRef(msg);
  msgRef.current = msg;
  const triggerReply = useCallback(() => {
    onReply(msgRef.current);
  }, [onReply]);
  const translateX = useSharedValue(0);
  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .onUpdate((e) => {
      if (isMe) {
        translateX.value = Math.max(-60, Math.min(0, e.translationX));
      } else {
        translateX.value = Math.min(60, Math.max(0, e.translationX));
      }
    })
    .onEnd(() => {
      if (Math.abs(translateX.value) > 40) {
        runOnJS(triggerReply)();
      }
      translateX.value = withSpring(0);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const renderReplyPreview = (replyTo: any) => {
    if (!replyTo) return null;

    if (typeof replyTo === 'string') {
      return (
        <TouchableOpacity
          onPress={() => onNavigateToMessage && onNavigateToMessage(replyTo)}
          activeOpacity={0.7}
          className="mb-2 px-3 py-2 rounded-lg border-l-4 overflow-hidden"
          style={{
            backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)',
            borderLeftColor: colors.primary.main,
            maxWidth: MAX_BUBBLE_WIDTH - 20,
          }}
        >
          <Text className="text-[12px] opacity-70" style={{ color: isMe ? '#fff' : colors.text }}>
            Replying to message...
          </Text>
        </TouchableOpacity>
      );
    }

    const isMeReply = String(replyTo.user?._id || replyTo.userId || '') === String(currentUserId || '');
    const author = isMeReply ? 'You' : (replyTo.user?.name || replyTo.authorName || 'Member');
    const text = replyTo.text || replyTo.message || '';

    const replyFiles = replyTo.files || [];
    const replyPrimaryFile = replyFiles[0];
    const replyFileType = getFileType(replyPrimaryFile);
    const isReplyVoice = !!(
      replyTo.audio ||
      replyTo.voice ||
      replyTo.isVoiceNote ||
      replyFileType === 'audio'
    );

    let replyIcon = null;
    let replyLabel = text;

    // A GIF reply shows the GIF itself, never its url: the GIPHY body, or a stored GIF's signed
    // url, which `getGridSrc` resolves from `imageUrls` like any other attachment. With neither
    // (not signed yet) the quote falls back to the GIF label.
    const replyGifFile = isGifFileMessage(replyTo) ? replyFiles[0] : null;
    const replyGifUrl = isGifMessageText(text)
      ? text.trim()
      : (replyGifFile && getGridSrc(replyGifFile)) || null;
    if (replyGifUrl || replyGifFile) {
      replyIcon = 'images';
      replyLabel = GIF_REPLY_LABEL;
    } else if (isReplyVoice) {
      replyIcon = 'mic';
      replyLabel = `Voice Message ${replyTo.duration ? `(${replyTo.duration})` : ''}`;
    } else if (replyFileType === 'image' || replyTo.image) {
      replyIcon = 'image';
      replyLabel = text || 'Photo';
    } else if (replyFileType === 'video' || replyTo.video) {
      replyIcon = 'videocam';
      replyLabel = text || 'Video';
    } else if (replyPrimaryFile || ['file', 'pdf', 'doc'].includes(replyFileType)) {
      replyIcon = 'document';
      replyLabel = text || replyPrimaryFile?.name || 'Document';
    }

    return (
      <TouchableOpacity
        onPress={() => onNavigateToMessage && onNavigateToMessage(replyTo)}
        activeOpacity={0.7}
        className="mb-2 px-3 py-2 rounded-lg border-l-4 overflow-hidden"
        style={{
          backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)',
          borderLeftColor: colors.primary.main,
          maxWidth: MAX_BUBBLE_WIDTH - 20,
          minWidth: 160,
        }}
      >
        <Text
          className="text-[11px] font-black mb-0.5"
          style={{ color: colors.primary.main }}
          numberOfLines={1}
        >
          {author}
        </Text>
        <View className="flex-row items-center">
          {replyIcon && !replyGifUrl && (
            <Icon
              name={replyIcon}
              size={12}
              color={isMe ? '#fff' : colors.text}
              style={{ marginRight: 4, opacity: 0.7 }}
            />
          )}
          {replyGifUrl ? (
            <Image
              source={{ uri: replyGifUrl }}
              style={{ width: 64, height: 64, borderRadius: 8, marginTop: 2 }}
              resizeMode="cover"
            />
          ) : (
            <Text
              className="text-[12px] opacity-70"
              style={{ color: isMe ? '#fff' : colors.text, flex: 1 }}
              numberOfLines={isReplyVoice ? undefined : 1}
              ellipsizeMode={isReplyVoice ? undefined : "tail"}
            >
              {replyLabel}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const handleReplyInternal = useCallback(() => {
    if (onReply && msg && canReply) {
      Vibration.vibrate(10);
      onReply(msg);
    }
  }, [onReply, msg, canReply]);

  const seenByOthers = useMemo(() => {
    return (msg.seenBy || []).filter((u: any) => {
      const uId = u.userId || u._id || u.id;
      return uId && String(uId) !== String(currentUserId);
    });
  }, [msg.seenBy, currentUserId]);

  const renderReactions = () => {
    const reactions = msg.reactions || [];
    if (reactions.length === 0) return null;

    console.log(`[Reactions] Rendering ${reactions.length} reactions for message:`, msg._id);

    const grouped = reactions.reduce((acc: any, r: any) => {
      const emoji = typeof r === 'string' ? r : (r.emoji || r.reaction);
      if (!emoji) return acc;
      const count = (r && typeof r === 'object' && Array.isArray(r.users)) ? r.users.length : 1;
      if (!acc[emoji]) acc[emoji] = 0;
      acc[emoji] += count;
      return acc;
    }, {});

    const emojiKeys = Object.keys(grouped);
    if (emojiKeys.length === 0) return null;

    return (
      <View
        className="flex-row flex-wrap items-center mt-1 px-1"
        style={{
          alignSelf: isMe ? 'flex-end' : 'flex-start',
        }}
      >
        {emojiKeys.map((emoji) => (
          <TouchableOpacity
            key={emoji}
            onPress={() => {
              console.log('[Reactions] Clicked emoji:', emoji);
              setSelectedEmojiTab(emoji);
              setShowReactionList(true);
            }}
            className="flex-row items-center px-1.5 py-0.5 rounded-full mr-1 mb-1 shadow-sm"
            style={{
              backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7',
              borderWidth: 1,
              borderColor: isDark ? '#3A3A3C' : '#E5E7EB',
            }}
          >
            <Text style={{ fontSize: 13 }}>{emoji}</Text>
            {grouped[emoji] > 1 && (
              <Text
                className="ml-1 text-[10px] font-bold"
                style={{ color: isDark ? '#fff' : '#000' }}
              >
                {grouped[emoji]}
              </Text>
            )}
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const renderReactionListModal = () => {
    const reactions = msg.reactions || [];
    if (reactions.length === 0) return null;

    const uniqueEmojis = Array.from(new Set(reactions.map((r: any) =>
      (typeof r === 'string' ? r : (r.emoji || r.reaction)) as string
    ).filter(Boolean))) as string[];

    const tabs: string[] = ['All', ...uniqueEmojis];

    const allReactions = reactions.flatMap((emojiGroup: any) => {
      const emoji = typeof emojiGroup === 'string' ? emojiGroup : (emojiGroup.emoji || emojiGroup.reaction);
      const users = emojiGroup.users || [];
      if (users.length > 0) {
        return users.map((u: any) => ({ ...u, emoji }));
      }
      return [{ ...emojiGroup, emoji }];
    });

    const filteredReactions = allReactions.filter((r: any) => {
      return selectedEmojiTab === 'All' || r.emoji === selectedEmojiTab;
    });

    return (
      <Modal
        visible={showReactionList}
        transparent
        animationType="slide"
        onRequestClose={() => setShowReactionList(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setShowReactionList(false)}
          />
          <View
            style={{
              backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingBottom: Platform.OS === 'ios' ? 40 : 20,
              maxHeight: '50%',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.1,
              shadowRadius: 10,
              elevation: 20,
            }}
          >
            {/* Handle Bar */}
            <View className="w-12 h-1.5 bg-zinc-300 dark:bg-zinc-700 rounded-full mt-3 mb-1" style={{ alignSelf: 'center' }} />

            <View className="flex-row items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
              <Text className="text-xl font-bold" style={{ color: colors.text }}>Reactions</Text>
              <TouchableOpacity
                onPress={() => setShowReactionList(false)}
                className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 items-center justify-center"
              >
                <Icon name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Emoji Tabs */}
            <View className="py-4">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20 }}
              >
                {tabs.map((tab) => {
                  const isActive = selectedEmojiTab === tab;
                  const count = tab === 'All'
                    ? allReactions.length
                    : allReactions.filter((r: any) => r.emoji === tab).length;

                  return (
                    <TouchableOpacity
                      key={tab}
                      onPress={() => setSelectedEmojiTab(tab)}
                      className="mr-3 px-4 py-2.5 rounded-2xl flex-row items-center border"
                      style={{
                        borderColor: isActive ? colors.primary.main : (isDark ? '#2C2C2E' : '#F2F2F7'),
                        backgroundColor: isActive ? (isDark ? '#2C2C2E' : '#F2F2F7') : 'transparent'
                      }}
                    >
                      {tab !== 'All' && <Text style={{ fontSize: 18 }}>{tab}</Text>}
                      <Text
                        className="text-sm font-bold"
                        style={{
                          color: isActive ? colors.primary.main : colors.textSecondary,
                          marginLeft: tab === 'All' ? 0 : 8,
                        }}
                      >
                        {tab === 'All' ? `All ${count}` : `${count}`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* User List */}
            <ScrollView className="px-6" showsVerticalScrollIndicator={false}>
              {filteredReactions.map((r: any, idx: number) => {
                const reactorId = r.userId || r._id || r.id;
                const isYou = reactorId && String(reactorId) === String(currentUserId);
                const displayName = isYou ? 'You' : (r.fullName || r.name || `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'Member');
                const emoji = r.emoji;
                const avatar = getAvatarProps({ ...r, name: displayName, _id: reactorId }, isYou);
                return (
                  <View
                    key={idx}
                    className="flex-row items-center py-4 border-b border-zinc-50 dark:border-zinc-900 justify-between"
                    style={{ borderBottomWidth: idx === filteredReactions.length - 1 ? 0 : 1 }}
                  >
                    <View className="flex-row items-center">
                      <View
                        className="w-11 h-11 rounded-full items-center justify-center mr-4 shadow-sm"
                        style={{ backgroundColor: avatar.color }}
                      >
                        <Text className="text-sm font-black text-white">{avatar.initials}</Text>
                      </View>
                      <View>
                        <Text className="font-bold text-[15px]" style={{ color: colors.text }}>
                          {displayName}
                        </Text>
                        <Text className="text-[11px] opacity-50" style={{ color: colors.text }}>
                          Reacted to this message
                        </Text>
                      </View>
                    </View>
                    <View className="w-10 h-10 rounded-full bg-zinc-50 dark:bg-zinc-900 items-center justify-center">
                      <Text style={{ fontSize: 22 }}>{emoji}</Text>
                    </View>
                  </View>
                );
              })}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  const formatSeenAt = (seenAtStr: string) => {
    if (!seenAtStr) return '';
    try {
      const d = new Date(seenAtStr);
      const today = new Date();
      const isToday = d.toDateString() === today.toDateString();
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (isToday) {
        return `Seen at ${timeStr}`;
      }
      const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      return `Seen ${dateStr} at ${timeStr}`;
    } catch (e) {
      return '';
    }
  };

  const renderSeenListModal = () => {
    return (
      <Modal
        visible={showSeenList}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSeenList(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setShowSeenList(false)}
          />
          <View
            style={{
              backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingBottom: Platform.OS === 'ios' ? 40 : 20,
              maxHeight: '50%',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.1,
              shadowRadius: 10,
              elevation: 20,
            }}
          >
            {/* Handle Bar */}
            <View className="w-12 h-1.5 bg-zinc-300 dark:bg-zinc-700 rounded-full mt-3 mb-1" style={{ alignSelf: 'center' }} />

            <View className="flex-row items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
              <View className="flex-row items-center">
                <Text className="text-xl font-bold mr-2" style={{ color: colors.text }}>Seen By</Text>
                <View className="bg-blue-100 dark:bg-blue-900/30 rounded-full px-2 py-0.5">
                  <Text className="text-blue-600 dark:text-blue-400 font-bold text-xs">
                    {seenByOthers.length}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setShowSeenList(false)}
                className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 items-center justify-center"
              >
                <Icon name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* User List */}
            <ScrollView className="px-6" showsVerticalScrollIndicator={false}>
              {seenByOthers.map((u: any, idx: number) => {
                const viewerId = u.userId || u._id || u.id;
                const displayName = u.fullName || u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Member';
                const avatar = getAvatarProps({ ...u, name: displayName, _id: viewerId }, false);
                return (
                  <View
                    key={idx}
                    className="flex-row items-center py-4 border-b border-zinc-50 dark:border-zinc-900 justify-between"
                    style={{ borderBottomWidth: idx === seenByOthers.length - 1 ? 0 : 1 }}
                  >
                    <View className="flex-row items-center flex-1 mr-2">
                      <View
                        className="w-11 h-11 rounded-full items-center justify-center mr-4 shadow-sm"
                        style={{ backgroundColor: avatar.color }}
                      >
                        <Text className="text-sm font-black text-white">{avatar.initials}</Text>
                      </View>
                      <View className="flex-1">
                        <Text className="font-bold text-[15px]" style={{ color: colors.text }}>
                          {displayName}
                        </Text>
                        <Text className="text-[11px] opacity-50" style={{ color: colors.text }} numberOfLines={1}>
                          {u.email || 'No email shared'}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-[10px] font-bold text-zinc-400">
                      {formatSeenAt(u.seenAt)}
                    </Text>
                  </View>
                );
              })}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  const openGalleryAt = (i: number) => {
    setGalleryIndex(Math.max(0, i));
    setGalleryVisible(true);
  };

  const renderImageGrid = () => {
    const GAP = 3;
    const W = SCREEN_WIDTH * 0.65;
    const H = 140;
    const half = (W - GAP) / 2;
    const count = imageFiles.length;

    const cell = (file: any, index: number, w: number, h: number, overlayText?: string) => (
      <GridImageCell
        src={getGridSrc(file)}
        label={overlayText ? '' : getPhotoLabel(file)}
        overlayText={overlayText}
        w={w}
        h={h}
        isDark={isDark}
        spinnerColor={isMe ? '#fff' : colors.primary.main}
        labelColor={isMe ? '#fff' : colors.text}
        onPress={() => openGalleryAt(index)}
        onLongPress={() => setShowReactionBar(true)}
      />
    );

    let body: React.ReactNode = null;
    if (count === 2) {
      body = (
        <View style={{ flexDirection: 'row', gap: GAP }}>
          {cell(imageFiles[0], 0, half, H)}
          {cell(imageFiles[1], 1, half, H)}
        </View>
      );
    } else if (count === 3) {
      body = (
        <View style={{ gap: GAP }}>
          <View style={{ flexDirection: 'row', gap: GAP }}>
            {cell(imageFiles[0], 0, half, H)}
            {cell(imageFiles[1], 1, half, H)}
          </View>
          {cell(imageFiles[2], 2, W, H)}
        </View>
      );
    } else {
      const shown = imageFiles.slice(0, 4);
      const remaining = count - 4;
      body = (
        <View style={{ gap: GAP }}>
          <View style={{ flexDirection: 'row', gap: GAP }}>
            {cell(shown[0], 0, half, H)}
            {cell(shown[1], 1, half, H)}
          </View>
          <View style={{ flexDirection: 'row', gap: GAP }}>
            {cell(shown[2], 2, half, H)}
            {cell(shown[3], 3, half, H, remaining > 0 ? `+${remaining + 1}` : undefined)}
          </View>
        </View>
      );
    }

    return (
      <View className="p-2">
        <View style={{ width: W }}>{body}</View>
      </View>
    );
  };

  const statusLayer = (
    <View className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-lg flex-row items-center bg-black/40">
      <Text className="text-[9px] text-white/90 mr-1">
        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
      {isMe && (
        <TouchableOpacity
          onPress={() => {
            if (seenByOthers.length > 0) {
              setShowSeenList(true);
            }
          }}
          disabled={seenByOthers.length === 0}
        >
          <Icon
            name={seenByOthers.length > 0 ? 'eye' : 'checkmark'}
            size={seenByOthers.length > 0 ? 12 : 10}
            color="#fff"
          />
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View onLayout={onLayout} style={{ zIndex: showReactionBar || showFullEmojiPicker ? 9999 : 1 }}>
      <MediaViewerModal
        isVisible={viewerVisible}
        onClose={() => setViewerVisible(false)}
        mediaUri={viewerUri}
        mediaType={viewerType}
        fileName={primaryFile?.name || 'Media'}
      />
      <ImageGalleryModal
        visible={galleryVisible}
        images={galleryImages}
        initialIndex={galleryIndex}
        onClose={() => setGalleryVisible(false)}
      />
      <View
        style={{
          alignSelf: isMe ? 'flex-end' : 'flex-start',
          marginHorizontal: 0,
          marginVertical: isSameUser(currentMessage, previousMessage) ? 0.3 : 2,
          maxWidth: '100%',
          paddingHorizontal: 2,
          // A received GIF has no avatar column and starts at the same 12 dp as a poll card (6 here + 4 on the bubble wrapper + 2 margin).
          paddingLeft: !isMe && (gifUri || isGifMsg) ? 6 : 2,
          overflow: 'visible',
        }}
      >
        {!isMe && !isSameUser(currentMessage, previousMessage) && (
          <Text
            className="text-[11px] font-bold mb-1 ml-1"
            style={{ color: getAvatarProps(msg.user, isMe).color }}
          >
            {msg?.user?.name || 'User'}
          </Text>
        )}
        {isMe && showHistory && msg.editHistory?.length > 0 && (
          <View className="mb-1" style={{ alignItems: isMe ? 'flex-end' : 'flex-start' }}>
            {msg.editHistory.map((h: any, i: number) => (
              <View
                key={i}
                className="px-3 py-1.5 rounded-2xl opacity-50 mb-1"
                style={{
                  backgroundColor: isMe ? '#00A884' : isDark ? '#202C33' : '#FFFFFF',
                  alignSelf: isMe ? 'flex-end' : 'flex-start',
                }}
              >
                <Text style={{ fontSize: 12, color: isMe ? '#fff' : colors.text }}>
                  {h.message || h.text}
                </Text>
              </View>
            ))}
          </View>
        )}
        <View className="flex-row items-end" style={{ flexShrink: 1, maxWidth: '100%' }}>
          {!isMe && !gifUri && !isGifMsg && (
            <View
              style={{
                width: 32,
                height: !isSameUser(currentMessage, previousMessage) ? 32 : 0,
                marginRight: 8,
                marginBottom: 0,
              }}
            >
              {!isSameUser(currentMessage, previousMessage) && (
                <View
                  className="w-full h-full rounded-full items-center justify-center"
                  style={{ backgroundColor: getAvatarProps(msg.user, isMe).color }}
                >
                  <Text className="text-[10px] font-black text-white">
                    {getAvatarProps(msg.user, isMe).initials}
                  </Text>
                </View>
              )}
            </View>
          )}
          <GestureDetector gesture={panGesture}>
            <Animated.View style={[animatedStyle, { paddingVertical: isSameUser(currentMessage, previousMessage) ? 1 : 2, paddingHorizontal: 4, overflow: 'visible', flexShrink: 1, maxWidth: MAX_BUBBLE_WIDTH }]}>
              <TouchableOpacity
                onLongPress={() => {
                  Vibration.vibrate(50);
                  setShowReactionBar(true);
                }}
                activeOpacity={0.9}
                style={{ flexShrink: 1 }}
              >
                <View
                  className="shadow-sm relative"
                  style={{
                    backgroundColor: ackUi?.bg
                      ? ackUi.bg
                      : isPinned
                        ? '#FFFDE7'
                        : isMe
                          ? '#00A884'
                          : isDark
                            ? '#202C33'
                            : '#FFFFFF',
                    borderRadius: hasTextOrFiles ? 8 : 5,
                    borderWidth:
                      msg._id === activeMatchId
                        ? 2.5
                        : ackUi?.border
                          ? 1
                          : !isPinned && !isMe
                            ? 1
                            : 0,
                    borderColor:
                      msg._id === activeMatchId ? '#FFD700' : (ackUi?.border || '#919EAB33'),
                    borderLeftWidth: isPinned ? 6 : undefined,
                    borderLeftColor: isPinned ? '#FBC02B' : undefined,
                    shadowColor: msg._id === activeMatchId ? '#FFD700' : 'transparent',
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: msg._id === activeMatchId ? 0.8 : 0,
                    shadowRadius: 10,
                    elevation: msg._id === activeMatchId ? 8 : 0,
                    borderBottomRightRadius: isMe ? 2 : (hasTextOrFiles ? 18 : 10),
                    borderBottomLeftRadius: isMe ? (hasTextOrFiles ? 18 : 10) : 2,
                    padding: 2,
                    ...(gifUri || isGifMsg ? { width: GIF_BUBBLE_WIDTH, maxWidth: '100%' } : {}),
                    marginVertical: isSameUser(currentMessage, previousMessage) ? 0.5 : 2,
                    marginHorizontal: !isMe ? 2 : 2,
                    overflow: gifUri || isGifMsg || fileType === 'image' || fileType === 'video' ? 'hidden' : 'visible',
                    minWidth: !gifUri && (fileType === 'image' || fileType === 'video')
                      ? SCREEN_WIDTH * 0.65 + 16
                      : (msg.replyToDetails || msg.replyTo) ? 200 : (hasTextOrFiles ? 50 : 50),
                  }}
                >
                  {isPinned && onPin && (
                    <View className="flex-row items-center px-2 py-1 bg-black/5 border-b border-black/10">
                      <Icon name="pin" size={12} color="#FBC02D" />
                      <Text className="text-[10px] font-black ml-1 text-[#C39529]">PINNED</Text>
                    </View>
                  )}
                  {ackUi && (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 10,
                        paddingVertical: 7,
                        backgroundColor: ackUi.stripBg,
                        borderBottomWidth: 1,
                        borderBottomColor: ackUi.stripBorder,
                      }}
                    >
                      <Icon name={ackUi.icon} size={13} color={ackUi.label} />
                      <Text
                        className="ml-1"
                        style={{
                          fontSize: 10,
                          fontWeight: '900',
                          letterSpacing: 0.5,
                          color: ackUi.label,
                        }}
                      >
                        READ CONFIRMATION REQUIRED
                      </Text>
                    </View>
                  )}
                  {(msg.replyToDetails || msg.replyTo) && (
                    <View className="p-1 px-2 pt-2">
                      {renderReplyPreview(msg.replyToDetails || msg.replyTo)}
                    </View>
                  )}
                  {fileType === 'video' && (
                    <View className="p-2 items-center">
                      <TouchableOpacity
                        onPress={() => handleMediaPress('video')}
                        onLongPress={() => setShowReactionBar(true)}
                        style={{
                          borderRadius: 12,
                          overflow: 'hidden',
                          backgroundColor: '#000',
                          width: SCREEN_WIDTH * 0.65,
                          aspectRatio: 16 / 9,
                        }}
                      >
                        {mediaUri ? (
                          <>
                            <Image
                              source={{ uri: mediaUri, cache: 'force-cache' }}
                              style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0.8 }}
                              resizeMode="cover"
                            />
                            <View className="absolute inset-0 items-center justify-center">
                              <View className="w-14 h-14 rounded-full bg-black/40 items-center justify-center border border-white/20">
                                <Icon name="play" size={28} color="#fff" style={{ marginLeft: 3 }} />
                              </View>
                            </View>
                          </>
                        ) : (
                          <ActivityIndicator color="#fff" size="small" />
                        )}
                      </TouchableOpacity>
                    </View>
                  )}
                  {imageFiles.length >= 2 && renderImageGrid()}
                  {!!gifUri && (
                    <View className="p-2">
                      <GifMessage
                        url={gifUri}
                        maxWidth={GIF_WIDTH}
                        fill
                        onLongPress={() => setShowReactionBar(true)}
                      />
                    </View>
                  )}
                  {fileType === 'image' && imageFiles.length < 2 && !gifUri && (
                    <View className="p-2 items-center">
                      <TouchableOpacity
                        onPress={() => handleMediaPress('image')}
                        onLongPress={() => setShowReactionBar(true)}
                        style={{
                          borderRadius: 12,
                          overflow: 'hidden',
                          width: SCREEN_WIDTH * 0.65,
                          aspectRatio: imageAspectRatio > 0 ? imageAspectRatio : 1,
                          maxHeight: SCREEN_WIDTH * 1.2,
                          backgroundColor: isDark ? '#1B2B34' : '#F2F2F7',
                          justifyContent: 'center',
                          alignItems: 'center',
                        }}
                      >
                        {mediaUri ? (
                          <>
                            <Image
                              source={{ uri: mediaUri, cache: 'force-cache' }}
                              style={{ width: '100%', height: '100%' }}
                              resizeMode="cover"
                              onLoadStart={() => setIsImageLoading(true)}
                              onLoadEnd={() => setIsImageLoading(false)}
                            />
                            {isImageLoading && (
                              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.05)' }}>
                                <ActivityIndicator size="small" color={isMe ? '#fff' : colors.primary.main} />
                              </View>
                            )}
                          </>
                        ) : (
                          <View className="flex-1 items-center justify-center">
                            <Icon name="image-outline" size={32} color="#aaa" />
                          </View>
                        )}
                      </TouchableOpacity>
                      {/* Caption for a lone appointment photo — same label the grid
                          shows (e.g. "Front of Home"). Gallery photos return an
                          empty label, so they stay caption-free like the grid. */}
                      {(() => {
                        const label = getPhotoLabel(primaryFile);
                        return label ? (
                          <Text
                            numberOfLines={1}
                            style={{
                              fontSize: 12,
                              fontWeight: '900',
                              marginTop: 4,
                              textAlign: 'center',
                              maxWidth: SCREEN_WIDTH * 0.65,
                              color: isMe ? '#fff' : colors.text,
                            }}
                          >
                            {label}
                          </Text>
                        ) : null;
                      })()}
                    </View>
                  )}
                  {['file', 'pdf', 'xls', 'word', 'doc'].includes(fileType) && (() => {
                    const docInfo = getDocStyleAndIcon(primaryFile?.name || 'File');
                    return (
                      <TouchableOpacity
                        onPress={handleOpenOrDownload}
                        onLongPress={() => setShowReactionBar(true)}
                        disabled={isDownloading}
                      >
                        <View
                          className="flex-row items-center p-3 gap-3"
                          style={{
                            borderRadius: 10,
                            width: isMe ? MAX_BUBBLE_WIDTH - 24 : MAX_BUBBLE_WIDTH - 64,
                            maxWidth: '100%',
                          }}
                        >
                          <View
                            className="w-10 h-10 rounded-lg items-center justify-center"
                            style={{ backgroundColor: docInfo.color }}
                          >
                            {isDownloading ? (
                              <DownloadProgressRing progress={downloadProgress} color="#fff" />
                            ) : docInfo.icon === 'acrobat-reader' ? (
                              <Fontisto name="acrobat-reader" size={18} color="#fff" />
                            ) : docInfo.icon === 'microsoft-excel' ? (
                              <MaterialCommunityIcons name="microsoft-excel" size={20} color="#fff" />
                            ) : (
                              <Icon name={docInfo.icon} size={20} color="#fff" />
                            )}
                          </View>
                          <View className="flex-1">
                            <Text
                              className="text-[13px] font-bold"
                              style={{ color: isMe ? '#fff' : colors.text }}
                              numberOfLines={1}
                            >
                              {isDownloading ? 'Downloading...' : primaryFile?.name || 'File'}
                            </Text>
                            {isDownloading && (
                              <Text
                                className="text-[10px] opacity-60"
                                style={{ color: isMe ? '#fff' : colors.text }}
                              >
                                {Math.round(downloadProgress * 100)}% complete
                              </Text>
                            )}
                          </View>
                          {!isDownloading && (
                            localFilePath ? (
                              <TouchableOpacity
                                onPress={handleOpenOrDownload}
                                style={{
                                  padding: 6,
                                  borderRadius: 20,
                                  backgroundColor: isMe ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.05)'
                                }}
                              >
                                <Icon
                                  name="eye-outline"
                                  size={16}
                                  color={isMe ? '#fff' : colors.text}
                                />
                              </TouchableOpacity>
                            ) : (
                              <TouchableOpacity
                                onPress={saveFileToDevice}
                                style={{
                                  padding: 6,
                                  borderRadius: 20,
                                  backgroundColor: isMe ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.05)'
                                }}
                              >
                                <Icon
                                  name="arrow-down-outline"
                                  size={16}
                                  color={isMe ? '#fff' : colors.text}
                                />
                              </TouchableOpacity>
                            )
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })()}
                  {isMsgVoice && (
                    <Pressable onLongPress={() => setShowReactionBar(true)}>
                      <View className="p-2">
                        <VoiceNotePlayer
                          uri={secureVoiceUri}
                          isMe={isMe}
                          isPinned={isPinned}
                          maxBubbleWidth={isMe ? MAX_BUBBLE_WIDTH - 24 : MAX_BUBBLE_WIDTH - 64}
                          mimeType={primaryFile?.mimeType || primaryFile?.fileType || ''}
                        />
                      </View>
                    </Pressable>
                  )}

                  {(() => {
                    const isSimpleText = !isMsgVoice && (!fileType || fileType === 'text');
                    if (msg.text && msg.text.trim().length > 0 && isSimpleText) {
                      return (
                        <View className={isGifMessageText(msg.text) ? 'px-2 pt-2 pb-0.5' : 'px-2.5 pt-1 pb-0.5'} style={{ minWidth: 50 }}>
                          {isGifMessageText(msg.text) ? (
                            <GifMessage
                              url={msg.text}
                              maxWidth={GIF_WIDTH}
                              fill
                              onLongPress={() => setShowReactionBar(true)}
                            />
                          ) : (
                            <ChatMessageText
                              text={msg.text}
                              isMe={isMe}
                              colors={colors}
                              isPinned={isPinned}
                              searchQuery={searchQuery}
                            />
                          )}
                          <View className="flex-row justify-end items-center mt-0 pb-0.5">
                            {msg.isEdited && (
                              <TouchableOpacity
                                onPress={() => isMe && setShowHistory(!showHistory)}
                                disabled={!isMe}
                              >
                                <Text
                                  className="text-[9px] font-bold mr-2"
                                  style={{
                                    color: isPinned
                                      ? '#B78103'
                                      : isMe
                                        ? 'rgba(255,255,255,0.85)'
                                        : colors.primary.main,
                                  }}
                                >
                                  {isMe && showHistory ? 'Hide Edits' : 'Edited'}
                                </Text>
                              </TouchableOpacity>
                            )}
                            <Text
                              style={{
                                fontSize: 9,
                                color: isMe ? 'rgba(255,255,255,0.75)' : colors.textSecondary,
                                fontWeight: 'bold',
                              }}
                            >
                              {new Date(msg.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </Text>
                            {isMe && (
                              msg.pending ? (
                                <ActivityIndicator size="small" color="#fff" style={{ marginLeft: 4 }} />
                              ) : (
                                <TouchableOpacity
                                  onPress={() => {
                                    if (seenByOthers.length > 0) {
                                      setShowSeenList(true);
                                    }
                                  }}
                                  disabled={seenByOthers.length === 0}
                                  className="ml-1"
                                >
                                  <Icon
                                    name={seenByOthers.length > 0 ? 'eye' : 'checkmark'}
                                    size={seenByOthers.length > 0 ? 12 : 11}
                                    color="#fff"
                                  />
                                </TouchableOpacity>
                              )
                            )}
                          </View>
                        </View>
                      );
                    }

                    return (
                      <>
                        {msg.text && msg.text.trim().length > 0 && !isMsgVoice && (
                          <View className="px-2.5 pt-1 pb-0.5" style={{ minWidth: 70 }}>
                            <ChatMessageText
                              text={msg.text}
                              isMe={isMe}
                              colors={colors}
                              isPinned={isPinned}
                              searchQuery={searchQuery}
                            />
                          </View>
                        )}
                        <View className="flex-row justify-end items-center px-1 pb-0.5 mt-0">
                          {msg.isEdited && (
                            <TouchableOpacity
                              onPress={() => isMe && setShowHistory(!showHistory)}
                              disabled={!isMe}
                            >
                              <Text
                                className="text-[9px] font-bold mr-2"
                                style={{
                                  color: isPinned
                                    ? '#B78103'
                                    : isMe
                                      ? 'rgba(255,255,255,0.85)'
                                      : colors.primary.main,
                                }}
                              >
                                {isMe && showHistory ? 'Hide Edits' : 'Edited'}
                              </Text>
                            </TouchableOpacity>
                          )}
                          <Text
                            className="text-[9px] opacity-60"
                            style={{ color: isMe ? '#fff' : colors.textSecondary }}
                          >
                            {new Date(msg.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </Text>
                          {isMe && (
                            msg.pending ? (
                              <ActivityIndicator size="small" color={isMe ? '#fff' : colors.primary.main} style={{ marginLeft: 4 }} />
                            ) : (
                              <TouchableOpacity
                                onPress={() => {
                                  if (seenByOthers.length > 0) {
                                    setShowSeenList(true);
                                  }
                                }}
                                disabled={seenByOthers.length === 0}
                                className="ml-1"
                              >
                                <Icon
                                  name={seenByOthers.length > 0 ? 'eye' : 'checkmark'}
                                  size={seenByOthers.length > 0 ? 13 : 11}
                                  color={isMe ? '#fff' : colors.primary.main}
                                />
                              </TouchableOpacity>
                            )
                          )}
                        </View>
                      </>
                    );
                  })()}
                </View>
                {renderReactions()}
              </TouchableOpacity>
            </Animated.View>
          </GestureDetector>
        </View>
      </View>

      <Modal
        visible={showReactionBar || showFullEmojiPicker}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {
          setShowReactionBar(false);
          setShowFullEmojiPicker(false);
        }}
      >
        <TouchableOpacity
          activeOpacity={1}
          className="flex-1 bg-black/70 items-center justify-center px-4"
          onPress={() => {
            setShowReactionBar(false);
            setShowFullEmojiPicker(false);
          }}
        >
          <TouchableOpacity activeOpacity={1} style={{ width: '90%', maxWidth: 340 }}>
            {!showFullEmojiPicker ? (
              <View
                className="rounded-2xl px-3 py-3 mb-3 shadow-2xl"
                style={{ display: canReact ? 'flex' : 'none', backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF' }}
              >
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ alignItems: 'center' }}
                >
                  {REACTION_EMOJIS.map((e) => (
                    <TouchableOpacity
                      key={e}
                      onPress={() => {
                        onReact(msg, e);
                        setShowReactionBar(false);
                      }}
                      className="mx-1.5"
                    >
                      <Text style={{ fontSize: 26 }}>{e}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    onPress={() => setShowFullEmojiPicker(true)}
                    className="ml-2 w-8 h-8 rounded-full items-center justify-center"
                    style={{ backgroundColor: isDark ? '#3A3A3C' : '#F2F2F7' }}
                  >
                    <Icon name="add" size={18} color={isDark ? '#fff' : '#555'} />
                  </TouchableOpacity>
                </ScrollView>
              </View>
            ) : (
              <View
                className="rounded-2xl p-3 mb-3 shadow-2xl"
                style={{ backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF' }}
              >
                <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
                  <View className="flex-row flex-wrap justify-center">
                    {MORE_EMOJIS.map((e) => (
                      <TouchableOpacity
                        key={e}
                        onPress={() => {
                          onReact(msg, e);
                          setShowReactionBar(false);
                          setShowFullEmojiPicker(false);
                        }}
                        className="m-1"
                      >
                        <Text style={{ fontSize: 26 }}>{e}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}
            <View
              className="rounded-2xl px-4 py-3 mb-3 shadow-2xl flex-row items-start"
              style={{ backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF' }}
            >
              <View
                className="w-8 h-8 rounded-full items-center justify-center mr-3 mt-0.5 flex-shrink-0"
                style={{ backgroundColor: getAvatarProps(msg.user, isMe).color }}
              >
                <Text className="text-[11px] font-black text-white">
                  {isMe ? 'ME' : getAvatarProps(msg.user, isMe).initials}
                </Text>
              </View>
              <View className="flex-1">
                <Text
                  className="text-[11px] font-bold mb-1 opacity-60"
                  style={{ color: isDark ? '#fff' : '#000' }}
                >
                  {isMe ? 'You' : msg.user?.name || 'Member'}
                </Text>
                {gifPreviewUri ? (
                  <View
                    className="rounded-xl overflow-hidden mt-1 shadow-sm"
                    style={{ width: 150, height: 150, backgroundColor: 'rgba(0,0,0,0.08)' }}
                  >
                    <Image
                      source={{ uri: gifPreviewUri }}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="cover"
                    />
                  </View>
                ) : msg.image ||
                  msg.imageUrl ||
                  (msg.files?.[0] && getFileType(msg.files[0]) === 'image') ? (
                  <View
                    className="rounded-xl overflow-hidden mt-1 shadow-sm"
                    style={{ width: 140, height: 90 }}
                  >
                    <Image
                      source={{ uri: msg.image || msg.imageUrl || msg.files?.[0]?.url }}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="cover"
                    />
                  </View>
                ) : msg.video ||
                  msg.videoUrl ||
                  (msg.files?.[0] && getFileType(msg.files[0]) === 'video') ? (
                  <View
                    className="rounded-xl items-center justify-center mt-1 shadow-sm"
                    style={{ width: 140, height: 90, backgroundColor: '#000' }}
                  >
                    <View className="w-10 h-10 rounded-full bg-white/20 items-center justify-center">
                      <Icon name="play" size={20} color="#fff" />
                    </View>
                    <Text className="text-[10px] text-white/70 mt-1 font-bold">VIDEO</Text>
                  </View>
                ) : msg.audio ||
                  msg.voice ||
                  (msg.files?.[0] && getFileType(msg.files[0]) === 'audio') ? (
                  <View className="flex-row items-center bg-zinc-100 dark:bg-zinc-800 rounded-lg px-3 py-2 mt-1">
                    <Icon name="mic" size={16} color={colors.primary.main} />
                    <Text className="text-[13px] ml-2 font-semibold" style={{ color: colors.text }}>
                      Voice Note
                    </Text>
                  </View>
                ) : msg.files?.[0] ? (
                  <View className="flex-row items-center bg-zinc-100 dark:bg-zinc-800 rounded-lg px-3 py-2 mt-1">
                    <Icon name="document-text" size={16} color={colors.primary.main} />
                    <Text
                      className="text-[13px] ml-2 font-semibold flex-1"
                      numberOfLines={1}
                      style={{ color: colors.text }}
                    >
                      {msg.files[0].name || 'Attachment'}
                    </Text>
                  </View>
                ) : (
                  <Text className="text-[14px]" style={{ color: colors.text }} numberOfLines={3}>
                    {msg.text || 'Message'}
                  </Text>
                )}
              </View>
            </View>
            <View
              className="rounded-2xl overflow-hidden shadow-2xl"
              style={{ backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF' }}
            >
              {!isViewOnly && canReply && (
                <TouchableOpacity
                  onPress={() => {
                    onReply(msg);
                    setShowReactionBar(false);
                  }}
                  className="flex-row items-center justify-between px-5 py-3.5 border-b"
                  style={{ borderBottomColor: isDark ? '#2C2C2E' : '#F2F2F7' }}
                >
                  <Text
                    className="font-semibold text-[15px]"
                    style={{ color: isDark ? '#fff' : '#000' }}
                  >
                    Reply
                  </Text>
                  <Icon name="arrow-undo-outline" size={20} color={isDark ? '#aaa' : '#555'} />
                </TouchableOpacity>
              )}
              {fileType === 'text' && !isMsgVoice && !!msg.text && !isGifMsg && (
                <TouchableOpacity
                  onPress={handleCopy}
                  className="flex-row items-center justify-between px-5 py-3.5 border-b"
                  style={{ borderBottomColor: isDark ? '#2C2C2E' : '#F2F2F7' }}
                >
                  <Text
                    className="font-semibold text-[15px]"
                    style={{ color: isDark ? '#fff' : '#000' }}
                  >
                    Copy
                  </Text>
                  <Icon name="copy-outline" size={20} color={isDark ? '#aaa' : '#555'} />
                </TouchableOpacity>
              )}
              {primaryFile && (
                <TouchableOpacity
                  onPress={saveFileToDevice}
                  className="flex-row items-center justify-between px-5 py-3.5 border-b"
                  style={{ borderBottomColor: isDark ? '#2C2C2E' : '#F2F2F7' }}
                >
                  <Text
                    className="font-semibold text-[15px]"
                    style={{ color: isDark ? '#fff' : '#000' }}
                  >
                    Download to Device
                  </Text>
                  <Icon name="download-outline" size={20} color={isDark ? '#aaa' : '#555'} />
                </TouchableOpacity>
              )}
              {!isViewOnly && onPin && (
                <TouchableOpacity
                  onPress={() => {
                    onPin(msg);
                    setShowReactionBar(false);
                  }}
                  className="flex-row items-center justify-between px-5 py-3.5 border-b"
                  style={{ borderBottomColor: isDark ? '#2C2C2E' : '#F2F2F7' }}
                >
                  <Text
                    className="font-semibold text-[15px]"
                    style={{ color: isDark ? '#fff' : '#000' }}
                  >
                    {msg.isPinned ? 'Unpin' : 'Pin'}
                  </Text>
                  <Icon
                    name={msg.isPinned ? 'pin' : 'pin-outline'}
                    size={20}
                    color={isDark ? '#aaa' : '#555'}
                  />
                </TouchableOpacity>
              )}
              {msg.isEdited && (
                <TouchableOpacity
                  onPress={() => {
                    onViewHistory(msg);
                    setShowReactionBar(false);
                  }}
                  className="flex-row items-center justify-between px-5 py-3.5"
                  style={{ borderBottomColor: isDark ? '#2C2C2E' : '#F2F2F7' }}
                >
                  <Text
                    className="font-semibold text-[15px]"
                    style={{ color: isDark ? '#fff' : '#000' }}
                  >
                    View History
                  </Text>
                  <Icon name="time-outline" size={20} color={isDark ? '#aaa' : '#555'} />
                </TouchableOpacity>
              )}
              {!isViewOnly && canEditOwn && isMe && !isGifMsg && (
                <>
                  {(() => {
                    const now = new Date();
                    const created = new Date(msg.createdAt);
                    const diffInMinutes = (now.getTime() - created.getTime()) / (1000 * 60);
                    const isUnder15Mins = diffInMinutes <= 15;

                    if (fileType === 'text' && !isMsgVoice && isUnder15Mins) {
                      return (
                        <TouchableOpacity
                          onPress={() => {
                            onEdit(msg);
                            setShowReactionBar(false);
                          }}
                          className="flex-row items-center justify-between px-5 py-3.5"
                          style={{ borderBottomColor: isDark ? '#2C2C2E' : '#F2F2F7' }}
                        >
                          <Text
                            className="font-semibold text-[15px]"
                            style={{ color: isDark ? '#fff' : '#000' }}
                          >
                            Edit
                          </Text>
                          <Icon name="create-outline" size={20} color={isDark ? '#aaa' : '#555'} />
                        </TouchableOpacity>
                      );
                    }
                    return null;
                  })()}
                </>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      {renderReactionListModal()}
      {renderSeenListModal()}
    </View>
  );
});
