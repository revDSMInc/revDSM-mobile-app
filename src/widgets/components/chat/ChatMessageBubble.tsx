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

import { useTheme } from '../../../theme/ThemeProvider';
import { MediaViewerModal } from '../../modals/MediaViewerModal';
import { REACTION_EMOJIS, MORE_EMOJIS } from './chat-constants';
import { getFileType, getAvatarProps, getNativeModules, cleanFilePath } from './chat-utils';
import { VoiceNotePlayer } from './VoiceNotePlayer';
import { DownloadProgressRing } from './DownloadProgressRing';
import { ChatMessageText } from './ChatMessageText';
import { ScrollView } from 'react-native-gesture-handler';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const MAX_BUBBLE_WIDTH = SCREEN_WIDTH * 0.75;

interface Props {
  bubbleProps: any;
  currentUserId: string;
  participants?: any[];
  onReply: (msg: any) => void;
  onEdit: (msg: any) => void;
  onReact: (msg: any, emoji: string) => void;
  onPin: (msg: any) => void;
  onViewHistory: (msg: any) => void;
  onNavigateToMessage?: (msg: any) => void;
  onDelete: (msgId: string) => void;
  imageUrls: Record<string, string>;
   isViewOnly?: boolean;
   searchQuery?: string;
   activeMatchId?: string | null;
   onLayout?: (event: any) => void;
 }

export function ChatMessageBubble({
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
   searchQuery,
   activeMatchId,
 }: Props) {
   const { colors, isDark } = useTheme();
   const { currentMessage, previousMessage } = bubbleProps;
   const msg = currentMessage as any;
   const position = bubbleProps.position || (String(msg.user?._id) === String(currentUserId) ? 'right' : 'left');
  const isMe = position === 'right';
  const isPinned = msg.isPinned || false;

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
    const raw =
      primaryFile?.filePath ||
      primaryFile?.path ||
      primaryFile?.url ||
      msg.image ||
      msg.imageUrl ||
      msg.video ||
      msg.videoUrl;
    if (!raw || typeof raw !== 'string') return '';
    // Priority: 1. Signed URL from cache, 2. Raw local/remote URI
    return imageUrls[raw] || imageUrls[cleanFilePath(raw)] || raw;
  }, [primaryFile, msg.image, msg.imageUrl, msg.video, msg.videoUrl, imageUrls]);

  const isMsgVoice = !!voiceUri || msg.isVoiceNote || msg.type === 'audio' || fileType === 'audio';

  const secureVoiceUri = useMemo(() => {
    if (!voiceUri) return '';
    const secure = imageUrls[voiceUri] || imageUrls[cleanFilePath(voiceUri)] || voiceUri;
    if (isMsgVoice) {
      console.log('[ChatMessageBubble] Voice URI resolved Full:', secure);
    }
    return secure;
  }, [voiceUri, imageUrls, isMsgVoice]);

  const [showHistory, setShowHistory] = useState(false);
  const [showReactionList, setShowReactionList] = useState(false);
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

  useEffect(() => {
    if (fileType === 'image' && mediaUri) {
      Image.getSize(mediaUri, (w, h) => {
        if (w && h) setImageAspectRatio(w / h);
      }, () => {});
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
      const path = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/revdsm_chat/${name}`;
      if (await ReactNativeBlobUtil.fs.exists(path)) setLocalFilePath(path);
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
        .fetch('GET', mediaUri)
        .progress((r: number, t: number) => {
          if (t > 0) setDownloadProgress(r / t);
        });
      const downloadedPath = res.path();
      setLocalFilePath(downloadedPath);
      setIsDownloading(false);
      if (FileViewer) await FileViewer.open(downloadedPath, { showOpenWithDialog: true });
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
  // === Swipe to Reply Logic ===
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

    // If replyTo is just a string (ID), we can't render the full preview
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

    const author = replyTo.user?.name || replyTo.authorName || 'Member';
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

    if (isReplyVoice) {
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
          {replyIcon && (
            <Icon
              name={replyIcon}
              size={12}
              color={isMe ? '#fff' : colors.text}
              style={{ marginRight: 4, opacity: 0.7 }}
            />
          )}
          <Text
            className="text-[12px] opacity-70"
            style={{ color: isMe ? '#fff' : colors.text, flex: 1 }}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {replyLabel}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const handleReplyInternal = useCallback(() => {
    if (onReply && msg) {
      Vibration.vibrate(10);
      onReply(msg);
    }
  }, [onReply, msg]);

  const renderReactions = () => {
    const reactions = msg.reactions || [];
    if (reactions.length === 0) return null;

    console.log(`[Reactions] Rendering ${reactions.length} reactions for message:`, msg._id);

    const grouped = reactions.reduce((acc: any, r: any) => {
      // Handle both object {emoji, reaction} and string formats
      const emoji = typeof r === 'string' ? r : (r.emoji || r.reaction);
      if (!emoji) return acc;
      if (!acc[emoji]) acc[emoji] = 0;
      acc[emoji]++;
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
      // Fallback for old/simple format
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
                    ? reactions.length
                    : reactions.filter((r: any) => {
                      const emoji = typeof r === 'string' ? r : (r.emoji || r.reaction);
                      return emoji === tab;
                    }).length;

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

  const statusLayer = (
    <View className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-lg flex-row items-center bg-black/40">
      <Text className="text-[9px] text-white/90 mr-1">
        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
      {isMe && <Icon name={msg.received ? 'checkmark-done' : 'checkmark'} size={10} color="#fff" />}
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
      <View
        style={{
          alignSelf: isMe ? 'flex-end' : 'flex-start',
          marginHorizontal: 16,
          marginVertical: 6,
          maxWidth: MAX_BUBBLE_WIDTH,
          paddingHorizontal: 2,
          paddingLeft: !isMe ? 2 : 2,
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
        <View className="flex-row items-end">
          {!isMe && (
            <View className="w-8 h-8 mr-2 mb-1">
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
            <Animated.View style={[animatedStyle, { padding: 4, overflow: 'visible' }]}>
              <TouchableOpacity
            onLongPress={() => {
              Vibration.vibrate(50);
              setShowReactionBar(true);
            }}
            activeOpacity={0.9}
            style={{ flexShrink: 1 }}
          >
            <View
              className="rounded-[18px] shadow-sm relative"
              style={{
                backgroundColor: isPinned
                  ? '#FFFDE7'
                  : isMe
                    ? '#00A884'
                    : isDark
                      ? '#202C33'
                      : '#FFFFFF',
                borderLeftWidth: isPinned ? 6 : 0,
                borderLeftColor: isPinned ? '#FBC02B' : 'transparent',
                borderWidth: msg._id === activeMatchId ? 2.5 : (!isPinned && !isMe ? 1 : 0),
                borderColor: msg._id === activeMatchId ? '#FFD700' : '#919EAB33',
                shadowColor: msg._id === activeMatchId ? '#FFD700' : 'transparent',
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: msg._id === activeMatchId ? 0.8 : 0,
                shadowRadius: 10,
                elevation: msg._id === activeMatchId ? 8 : 0,
                borderBottomRightRadius: isMe ? 2 : 18,
                borderBottomLeftRadius: isMe ? 18 : 2,
                padding: 2,
                margin: 2,
                marginHorizontal: !isMe ? 2 : 2,
                overflow: 'visible',
              }}
            >
              {isPinned && (
                <View className="flex-row items-center px-2 py-1 bg-black/5 border-b border-black/10">
                  <Icon name="pin" size={12} color="#FBC02D" />
                  <Text className="text-[10px] font-black ml-1 text-[#C39529]">PINNED</Text>
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
                          source={{ uri: mediaUri }} 
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
              {fileType === 'image' && (
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
                    }}
                  >
                    {mediaUri ? (
                      <Image
                        source={{ uri: mediaUri }}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="contain"
                      />
                    ) : (
                      <View className="flex-1 items-center justify-center">
                        <Icon name="image-outline" size={32} color="#aaa" />
                      </View>
                    )}
                  </TouchableOpacity>
                </View>
              )}
              {['file', 'pdf', 'xls', 'word', 'doc'].includes(fileType) && (
                <TouchableOpacity
                  onPress={handleOpenOrDownload}
                  onLongPress={() => setShowReactionBar(true)}
                >
                  <View
                    className="flex-row items-center p-3 gap-3"
                    style={{ borderRadius: 10, width: MAX_BUBBLE_WIDTH - 4 }}
                  >
                    <View className="w-10 h-10 rounded-lg bg-blue-500 items-center justify-center">
                      {isDownloading ? (
                        <DownloadProgressRing progress={downloadProgress} color="#fff" />
                      ) : (
                        <Icon name="document" size={20} color="#fff" />
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
                  </View>
                </TouchableOpacity>
              )}
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

              {msg.text && !isMsgVoice && (
                <View className="px-3 pt-1.5 pb-0">
                  <ChatMessageText
                    text={msg.text}
                    isMe={isMe}
                    colors={colors}
                    isPinned={isPinned}
                    searchQuery={searchQuery}
                  />
                </View>
              )}

              {/* Unified Bottom Timestamp */}
              <View className="flex-row justify-end items-center px-2 pb-1 mt-0">
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
                  <View className="ml-1">
                    <Icon 
                      name={msg.received ? 'checkmark-done' : 'checkmark'} 
                      size={11} 
                      color={isMe ? '#fff' : colors.primary.main} 
                    />
                  </View>
                )}
              </View>
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
                style={{ backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF' }}
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
                {msg.image ||
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
            {!isViewOnly && (
              <View
                className="rounded-2xl overflow-hidden shadow-2xl"
                style={{ backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF' }}
              >
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
                {fileType === 'text' && !isMsgVoice && !!msg.text && (
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
                <TouchableOpacity
                  onPress={() => {
                    onPin(msg);
                    setShowReactionBar(false);
                  }}
                  className={`flex-row items-center justify-between px-5 py-3.5 ${isMe ? 'border-b' : ''
                    }`}
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
                {msg.isEdited && (
                  <TouchableOpacity
                    onPress={() => {
                      onViewHistory(msg);
                      setShowReactionBar(false);
                    }}
                    className="flex-row items-center justify-between px-5 py-3.5 border-b"
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
                {isMe && (
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
                            className="flex-row items-center justify-between px-5 py-3.5 border-b"
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
                    <TouchableOpacity
                      onPress={() => {
                        Alert.alert(
                          'Delete Message',
                          'This will permanently delete your message.',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Delete',
                              style: 'destructive',
                              onPress: () => {
                                onDelete(msg._id);
                                setShowReactionBar(false);
                              },
                            },
                          ]
                        );
                      }}
                      className="flex-row items-center justify-between px-5 py-3.5"
                    >
                      <Text className="font-semibold text-[15px] text-red-500">Delete</Text>
                      <Icon name="trash-outline" size={20} color="#EF4444" />
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      {renderReactionListModal()}
    </View>
  );
}
// FORCE_REBUNDLE_MARKER_12345
