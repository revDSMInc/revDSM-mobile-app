import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Keyboard, Platform, Alert } from 'react-native';
import { GiftedChat, IMessage } from 'react-native-gifted-chat';
import { launchImageLibrary } from 'react-native-image-picker';
import ChatService from '../services/api/ChatService';
import { useVoiceNote } from '../hooks/useVoiceNote';
import * as DocumentPicker from '@react-native-documents/picker';
import { logEvent } from '../services/api/LoggerService';
import { buildChatLogFiles } from '../utils/activity-log/chat-log-files';
import RNFS from 'react-native-fs';

const getWebMessageType = (file?: { name?: string | null; type?: string | null }) => {
  if (!file) return 'file';
  const name = (file.name || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();
  const ext = name.split('.').pop() || '';

  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) {
    return 'image';
  }
  if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'avi', 'wmv', 'flv', 'mkv'].includes(ext)) {
    return 'video';
  }
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'flac', 'wma', 'opus', 'ogg'].includes(ext)) {
    return 'audio';
  }
  if (mime === 'application/pdf' || ext === 'pdf') {
    return 'pdf';
  }
  if (mime.includes('msword') || mime.includes('officedocument.wordprocessingml') || ext === 'doc' || ext === 'docx') {
    return 'doc';
  }
  if (mime.includes('spreadsheetml') || mime.includes('ms-excel') || ext === 'xls' || ext === 'xlsx') {
    return 'xls';
  }
  if (mime === 'text/csv' || ext === 'csv') {
    return 'csv';
  }
  if (mime.startsWith('text/') || ext === 'txt') {
    return 'txt';
  }
  return 'file';
};

export const useChatLogic = (
  chatId: string | null,
  messages: any[],
  setMessages: any,
  currentUserId: string,
  user: any,
  isChannel: boolean,
  participants: any[],
  leadId?: string
) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [editingMessage, setEditingMessage] = useState<any>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [composerText, setComposerText] = useState('');
  const composerTextRef = useRef('');
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<string[]>([]);

  type PendingAppointmentPhoto = {
    _id?: string;
    s3url: string;
    bucketName?: string;
    category?: string;
    subcategory?: string;
    label?: string;
    secureUrl?: string;
  };
  type PendingAttachment =
    | {
        id: string;
        kind: 'appointment';
        photo: PendingAppointmentPhoto;
        previewUri?: string;
        label?: string;
      }
    | {
        id: string;
        kind: 'gallery';
        asset: { uri?: string; fileName?: string; type?: string };
        previewUri?: string;
        isImage: boolean;
      };
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);

  const addPendingAppointmentPhotos = useCallback((photos: PendingAppointmentPhoto[]) => {
    if (!photos?.length) return;
    setPendingAttachments((prev) => [
      ...prev,
      ...photos.map((p, i) => ({
        id: `appt_${Date.now()}_${i}_${Math.random()}`,
        kind: 'appointment' as const,
        photo: p,
        previewUri: p.secureUrl,
        label: p.label || p.subcategory || p.category || 'Photo',
      })),
    ]);
  }, []);

  const removePendingAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'android' ? 'keyboardDidShow' : 'keyboardWillShow',
      () => setKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'android' ? 'keyboardDidHide' : 'keyboardWillHide',
      () => setKeyboardVisible(false)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const allMessagesWithSystem = useMemo(() => {
    const systemMsgs = participants.map((p: any, idx: number) => ({
      _id: `sys-${p._id || idx}`,
      text: `${p.firstName || p.name || 'Member'} added to the chat`,
      createdAt: new Date(0),
      system: true,
      user: { _id: p._id || p.id || `p-${idx}`, name: p.firstName || p.name || 'Member' },
    }));
    return [...messages, ...systemMsgs];
  }, [messages, participants]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchIndex(0);
      return;
    }
    const matches = allMessagesWithSystem
      .filter((m: any) => m.text?.toLowerCase().includes(searchQuery.toLowerCase()))
      .map((m: any) => m._id);
    setSearchResults(matches);
    setSearchIndex(0);
  }, [searchQuery, allMessagesWithSystem]);

  const filteredMessages = allMessagesWithSystem;

  const {
    recordingState,
    recordingTime,
    recordedUri,
    startRecording,
    stopRecording,
    cancelRecording,
    reset,
  } = useVoiceNote();

  const handleComposerChange = (text: string) => {
    console.log('[Mentions Debug] Input changed. Text:', JSON.stringify(text));
    setComposerText(text);
    composerTextRef.current = text;
    const lastWord = text.split(/\s/).pop() || '';
    const startsWithAt = lastWord.startsWith('@');
    console.log('[Mentions Debug] Last word:', JSON.stringify(lastWord), 'Starts with @:', startsWithAt);
    setShowMentions(startsWithAt);
    if (chatId) {
      if (isChannel) {
        ChatService.emitChannelTyping(chatId, text.length > 0);
      } else {
        ChatService.emitTyping(chatId, text.length > 0);
      }
    }
  };

  const onSend = useCallback(
    async (newMsgs: IMessage[] = []) => {
      if (!chatId) return;
      const raw = newMsgs[0];
      const tempId = `temp_${Date.now()}`;
      try {
        if (editingMessage) {
          const editedText = raw.text || composerText;
          if (user?._id) {
            logEvent('edit', {
              user_id: user._id,
              module_type: isChannel ? 'team_channel' : 'chat',
              created_by: user._id,
              meta: {
                leadId,
                type: isChannel ? 'team_channel' : 'chat',
                action: 'Edited message',
                messageType: 'text',
                messageId: editingMessage._id,
                message: editedText,
              },
            });
          }
          setMessages((prev: any[]) =>
            prev.map((m) =>
              m._id === editingMessage._id ? { ...m, text: editedText, isEdited: true } : m
            )
          );
          await ChatService.editMessage(editingMessage._id, editedText, isChannel);
          setEditingMessage(null);
        } else {
          if (user?._id) {
            logEvent('send', {
              user_id: user._id,
              module_type: isChannel ? 'team_channel' : 'chat',
              created_by: user._id,
              meta: {
                leadId,
                type: isChannel ? 'team_channel' : 'chat',
                action: 'Sent text message',
                messageType: 'text',
                isReply: !!replyingTo,
                message: raw.text,
              },
            });
          }
          const optimistic = {
            ...raw,
            _id: tempId,
            createdAt: new Date(),
            user: { _id: String(currentUserId), name: user?.firstName || 'Me' },
            pending: true,
            sent: false,
            replyTo: replyingTo?._id,
            replyToDetails: replyingTo,
          };
          setMessages((prev: any[]) => GiftedChat.append(prev, [optimistic]));
          await ChatService.sendMessageREST({
            chatId,
            message: raw.text,
            replyTo: replyingTo?._id,
            isChannel,
          });
        }
      } catch {
        setMessages((prev: any[]) => prev.filter((m) => m._id !== tempId));
      } finally {
        setReplyingTo(null);
        setComposerText('');
        if (chatId) {
          if (isChannel) {
            ChatService.emitChannelTyping(chatId, false);
          } else {
            ChatService.emitTyping(chatId, false);
          }
        }
      }
    },
    [chatId, replyingTo, editingMessage, setMessages, currentUserId, user, composerText, isChannel, leadId]
  );

  const handleAttach = useCallback(() => {
    launchImageLibrary({ mediaType: 'mixed', selectionLimit: 5 }, (response) => {
      if (!response.assets?.length) return;
      setPendingAttachments((prev) => [
        ...prev,
        ...response.assets!.map((f, i) => ({
          id: `gal_${Date.now()}_${i}_${Math.random()}`,
          kind: 'gallery' as const,
          asset: { uri: f.uri, fileName: f.fileName, type: f.type, fileSize: f.fileSize },
          previewUri: f.uri,
          isImage: !!f.type?.startsWith('image'),
        })),
      ]);
    });
  }, []);

  const sendGalleryAssets = useCallback(
    async (
      assets: Array<{ uri?: string; fileName?: string; type?: string; fileSize?: number }>,
      reply?: any
    ) => {
      if (!assets?.length || !chatId) return;
      const tempId = `temp_${Date.now()}_${Math.random()}`;
      const files = assets.map((f, i) => {
        const isImg = f.type?.startsWith('image');
        return {
          url: f.uri,
          uri: f.uri,
          name: f.fileName || `file_${i}`,
          mimeType: f.type,
          type: isImg ? 'image' : 'file',
        };
      });
      const firstIsImg = assets[0]?.type?.startsWith('image');
      const optimistic = {
        _id: tempId,
        text: '',
        image: assets.length === 1 && firstIsImg ? assets[0].uri : undefined,
        createdAt: new Date(),
        user: { _id: String(currentUserId) },
        files,
        replyTo: reply?._id,
        replyToDetails: reply,
        pending: true,
        sent: false,
        received: false,
      };
      setMessages((prev: any[]) => GiftedChat.append(prev, [optimistic]));
      try {
        const stored = await ChatService.sendFilesMessage(
          chatId,
          assets.map((f) => ({ uri: f.uri, name: f.fileName, type: f.type })),
          '',
          reply?._id,
          isChannel
        );
        if (user?._id) {
          const first = assets[0];
          const storedFiles = stored?.files?.length
            ? stored.files
            : assets.map((a) => ({ fileName: a.fileName, fileType: a.type, fileSize: a.fileSize }));
          logEvent('send', {
            user_id: user._id,
            module_type: isChannel ? 'team_channel' : 'chat',
            created_by: user._id,
            meta: {
              leadId,
              type: isChannel ? 'team_channel' : 'chat',
              isEdit: false,
              isReply: !!reply,
              messageType: getWebMessageType({ name: first?.fileName, type: first?.type }),
              fileName: assets.map((a) => a.fileName || 'Attachment').join(', '),
              fileSize: assets.length,
              files: buildChatLogFiles(storedFiles),
              message: ' ',
              action: `sent ${assets.length} attachment(s)`,
              resetCycle: 0,
            },
          });
        }
      } catch (err: any) {
        console.warn('[Media] send failed:', err?.message || err);
        setMessages((prev: any[]) => prev.filter((m) => m._id !== tempId));
        Alert.alert('Send Failed', 'Failed to send attachment. Please try again.');
      }
    },
    [chatId, currentUserId, setMessages, user, leadId, isChannel]
  );

  const sendImageAsMessage = useCallback(
    async (uri: string, fileName = 'Photo') => {
      if (!uri || !chatId) return;
      const tempId = `temp_${Date.now()}_${Math.random()}`;
      const safeName = /\.(jpe?g|png|gif|webp)$/i.test(fileName) ? fileName : `${fileName}.jpg`;

      const optimistic = {
        _id: tempId,
        text: '',
        image: uri,
        createdAt: new Date(),
        user: { _id: String(currentUserId) },
        files: [{ url: uri, name: safeName, mimeType: 'image/jpeg', type: 'image' }],
        pending: true,
        sent: false,
        received: false,
      };
      setMessages((prev: any[]) => GiftedChat.append(prev, [optimistic]));

      try {
        let uploadUri = uri;
        if (/^https?:\/\//i.test(uri)) {
          const localPath = `${RNFS.CachesDirectoryPath}/chat_photo_${Date.now()}.jpg`;
          const { statusCode } = await RNFS.downloadFile({ fromUrl: uri, toFile: localPath }).promise;
          if (statusCode && statusCode >= 200 && statusCode < 300) {
            uploadUri = localPath;
          } else {
            throw new Error(`Download failed with status ${statusCode}`);
          }
        }
        const stored = await ChatService.sendFileMessage(
          chatId,
          { uri: uploadUri, name: safeName, type: 'image/jpeg' },
          '',
          undefined,
          isChannel
        );
        if (user?._id) {
          let localSize = 0;
          try {
            localSize = (await RNFS.stat(uploadUri.replace('file://', ''))).size;
          } catch {
          }
          const storedFiles = stored?.files?.length
            ? stored.files
            : [{ fileName: safeName, fileType: 'image/jpeg', fileSize: localSize }];
          logEvent('send', {
            user_id: user._id,
            module_type: isChannel ? 'team_channel' : 'chat',
            created_by: user._id,
            meta: {
              leadId,
              type: isChannel ? 'team_channel' : 'chat',
              isEdit: false,
              isReply: false,
              messageType: 'image',
              fileName: safeName,
              fileSize: 1,
              files: buildChatLogFiles(storedFiles),
              message: ' ',
              action: 'sent an attachment',
              resetCycle: 0,
            },
          });
        }
      } catch (err: any) {
        console.warn('[Media] annotated photo send failed:', err?.message || err);
        setMessages((prev: any[]) => prev.filter((m) => m._id !== tempId));
        Alert.alert('Send Failed', 'Failed to send photo. Please try again.');
      }
    },
    [chatId, currentUserId, setMessages, user, leadId, isChannel]
  );

  const sendAppointmentPhotos = useCallback(
    async (
      photos: Array<{
        _id?: string;
        s3url: string;
        bucketName?: string;
        category?: string;
        subcategory?: string;
        label?: string;
        secureUrl?: string;
      }>,
      reply?: any
    ) => {
      if (!photos?.length || !chatId) return;
      const tempId = `temp_${Date.now()}_${Math.random()}`;

      const filesPayload = photos.map((p) => {
        const label = p.label || p.subcategory || p.category || 'Appointment Photo';
        const fileName = `${label.replace(/[\/\\]/g, '-')}.jpg`;
        return {
          _id: p._id,
          bucketName: p.bucketName,
          filePath: p.s3url,
          category: p.category || '',
          subcategory: label,
          fileName,
          fileType: 'image/jpeg',
        };
      });

      const optimistic = {
        _id: tempId,
        text: '',
        createdAt: new Date(),
        user: { _id: String(currentUserId) },
        files: filesPayload.map((f, i) => ({
          ...f,
          name: f.fileName,
          type: 'image',
          mimeType: 'image/jpeg',
          path: f.filePath,
          url: photos[i].secureUrl || undefined,
          previewUrl: photos[i].secureUrl || undefined,
          isAppointmentPhoto: true,
        })),
        replyTo: reply?._id,
        replyToDetails: reply,
        pending: true,
        sent: false,
        received: false,
      };
      setMessages((prev: any[]) => GiftedChat.append(prev, [optimistic]));

      try {
        const stored = await ChatService.sendAppointmentPhotos(chatId, filesPayload, ' ', reply?._id, isChannel);
        if (user?._id) {
          const storedFiles = stored?.files?.length ? stored.files : filesPayload;
          logEvent('send', {
            user_id: user._id,
            module_type: isChannel ? 'team_channel' : 'chat',
            created_by: user._id,
            meta: {
              leadId,
              type: isChannel ? 'team_channel' : 'chat',
              isEdit: false,
              isReply: !!reply,
              messageType: 'appointment_photo',
              fileName: filesPayload.map((f) => f.fileName).join(', '),
              fileSize: filesPayload.length,
              files: buildChatLogFiles(storedFiles),
              message: ' ',
              action: `sent ${filesPayload.length} appointment photo(s)`,
              resetCycle: 0,
            },
          });
        }
      } catch (err: any) {
        console.warn('[Media] appointment photos send failed:', err?.message || err);
        setMessages((prev: any[]) => prev.filter((m) => m._id !== tempId));
        Alert.alert('Send Failed', 'Failed to send photos. Please try again.');
      }
    },
    [chatId, currentUserId, setMessages, user, leadId, isChannel]
  );

  const sendTextMessage = useCallback(
    async (text: string, reply?: any) => {
      if (!chatId || !text?.trim()) return;
      const tempId = `temp_${Date.now()}`;
      if (user?._id) {
        logEvent('send', {
          user_id: user._id,
          module_type: isChannel ? 'team_channel' : 'chat',
          created_by: user._id,
          meta: {
            leadId,
            type: isChannel ? 'team_channel' : 'chat',
            action: 'Sent text message',
            messageType: 'text',
            isReply: !!reply,
            message: text,
          },
        });
      }
      const optimistic = {
        _id: tempId,
        text,
        createdAt: new Date(),
        user: { _id: String(currentUserId), name: user?.firstName || 'Me' },
        pending: true,
        sent: false,
        replyTo: reply?._id,
        replyToDetails: reply,
      };
      setMessages((prev: any[]) => GiftedChat.append(prev, [optimistic]));
      try {
        await ChatService.sendMessageREST({ chatId, message: text, replyTo: reply?._id, isChannel });
      } catch {
        setMessages((prev: any[]) => prev.filter((m) => m._id !== tempId));
      }
    },
    [chatId, currentUserId, user, setMessages, isChannel, leadId]
  );

  const handleSend = useCallback(async () => {
    if (!chatId) return;
    const text = (composerTextRef.current || composerText || '').trim();

    if (editingMessage) {
      const editedText = text;
      if (user?._id) {
        logEvent('edit', {
          user_id: user._id,
          module_type: isChannel ? 'team_channel' : 'chat',
          created_by: user._id,
          meta: {
            leadId,
            type: isChannel ? 'team_channel' : 'chat',
            action: 'Edited message',
            messageType: 'text',
            messageId: editingMessage._id,
            message: editedText,
          },
        });
      }
      setMessages((prev: any[]) =>
        prev.map((m) => (m._id === editingMessage._id ? { ...m, text: editedText, isEdited: true } : m))
      );
      try {
        await ChatService.editMessage(editingMessage._id, editedText, isChannel);
      } catch (e) {
        console.warn('[Chat] edit failed:', e);
      }
      setEditingMessage(null);
      setComposerText('');
      composerTextRef.current = '';
      return;
    }

    const atts = pendingAttachments;
    if (!text && atts.length === 0) return;

    const reply = replyingTo;
    const appointmentPhotos = atts
      .filter((a) => a.kind === 'appointment')
      .map((a: any) => a.photo);
    const galleryAssets = atts.filter((a) => a.kind === 'gallery').map((a: any) => a.asset);

    setPendingAttachments([]);
    setComposerText('');
    composerTextRef.current = '';
    setReplyingTo(null);
    if (chatId) {
      if (isChannel) ChatService.emitChannelTyping(chatId, false);
      else ChatService.emitTyping(chatId, false);
    }

    try {
      if (appointmentPhotos.length) await sendAppointmentPhotos(appointmentPhotos, reply);
      if (galleryAssets.length) await sendGalleryAssets(galleryAssets, reply);
      if (text) await sendTextMessage(text, reply);
    } catch (e) {
      console.warn('[Chat] handleSend failed:', e);
    }
  }, [
    chatId,
    composerText,
    pendingAttachments,
    editingMessage,
    replyingTo,
    isChannel,
    user,
    leadId,
    setMessages,
    sendAppointmentPhotos,
    sendGalleryAssets,
    sendTextMessage,
  ]);

  // A GIF goes out as a text message whose body is the GIPHY URL (see utils/gif-message.ts).
  const sendGif = useCallback(
    async (url: string) => {
      if (!chatId || !url) return;
      const reply = replyingTo;
      setReplyingTo(null);
      try {
        await sendTextMessage(url, reply);
      } catch (e) {
        console.warn('[Chat] sendGif failed:', e);
      }
    },
    [chatId, replyingTo, sendTextMessage]
  );

  const handleDocumentAttach = useCallback(async () => {
    try {
      const results = await DocumentPicker.pick({
        allowMultiSelection: true,
        type: [DocumentPicker.types.allFiles],
      });

      if (results && chatId) {
        const docs = results;
        const optimistics = docs.map((f) => ({
          _id: `temp_${Date.now()}_${Math.random()}`,
          text: f.name || 'Document',
          createdAt: new Date(),
          user: { _id: String(currentUserId) },
          files: [
            { url: f.uri, name: f.name, mimeType: f.type, type: 'file' },
          ],
          pending: true,
          sent: false,
          received: false,
        }));
        setMessages((prev: any[]) => GiftedChat.append(prev, optimistics));
        const storedDocs = await Promise.all(docs.map((f) =>
          ChatService.sendFileMessage(chatId, { uri: f.uri, name: f.name, type: f.type }, '', undefined, isChannel)
        ));
        if (user?._id) {
          const firstDoc = docs[0];
          const storedFiles = storedDocs.flatMap((s: any, i: number) =>
            s?.files?.length
              ? s.files
              : [{
                  fileName: docs[i]?.name || 'Document',
                  fileType: docs[i]?.type || '',
                  fileSize: docs[i]?.size ?? 0,
                }]
          );
          logEvent('send', {
            user_id: user._id,
            module_type: isChannel ? 'team_channel' : 'chat',
            created_by: user._id,
            meta: {
              leadId,
              type: isChannel ? 'team_channel' : 'chat',
              isEdit: false,
              isReply: false,
              messageType: getWebMessageType({
                name: firstDoc?.name,
                type: firstDoc?.type,
              }),
              fileName: docs.map((f) => f.name || 'Document').join(', '),
              fileSize: docs.length,
              files: buildChatLogFiles(storedFiles),
              message: ' ',
              action: `sent ${docs.length} attachment(s)`,
              resetCycle: 0,
            },
          });
        }
      }
    } catch (err: any) {
      if (DocumentPicker.isErrorWithCode(err) && err.code === DocumentPicker.errorCodes.OPERATION_CANCELED) {
        return;
      }
      console.warn('[Document] send failed:', err?.message || err);
      setMessages((prev: any[]) => prev.filter((m) => typeof m._id === 'string' && m._id.startsWith('temp_')));
      Alert.alert('Send Failed', 'Failed to send document. Please try again.');
    }
  }, [chatId, currentUserId, setMessages, user, leadId, isChannel]);

  const handleSendVoiceNote = async (uri: string) => {
    if (!uri || !chatId) return;
    console.log('[Media] Sending voice note:', uri);
    let voiceLogMeta: { fileName: string; fileSize: number } | null = null;
    if (user?._id) {
      const fileName = uri.split('/').pop() || `voice_${Date.now()}.m4a`;
      let fileSize = 12000;
      try {
        const path = uri.replace('file://', '');
        const stat = await RNFS.stat(path);
        fileSize = stat.size;
      } catch (e) {
        console.warn('[Chat] Failed to stat voice note file:', e);
      }

      voiceLogMeta = { fileName, fileSize };
    }
    const tempId = `temp_${Date.now()}`;
    try {
      const fileName = uri.split('/').pop() || `voice_${Date.now()}.m4a`;
      const optimistic = {
        _id: tempId,
        text: '🎤 Voice Note',
        createdAt: new Date(),
        user: { _id: String(currentUserId) },
        voice: uri,
        audio: uri,
        isVoiceNote: true,
        files: [{ url: uri, name: fileName, mimeType: 'audio/m4a', type: 'audio' }],
        pending: false,
        sent: true,
        received: false,
      };

      reset();

      setMessages((prev: any[]) => GiftedChat.append(prev, [optimistic]));

      const stored = await ChatService.sendFileMessage(
        chatId,
        { uri, name: fileName, type: 'audio/m4a' },
        '',
        undefined,
        isChannel
      );
      if (user?._id && voiceLogMeta) {
        const storedFiles = stored?.files?.length
          ? stored.files
          : [{
              fileName: voiceLogMeta.fileName,
              fileType: 'audio/m4a',
              fileSize: voiceLogMeta.fileSize,
            }];
        logEvent('send', {
          user_id: user._id,
          module_type: isChannel ? 'team_channel' : 'chat',
          created_by: user._id,
          meta: {
            leadId,
            type: isChannel ? 'team_channel' : 'chat',
            action: 'Sent voice memo',
            messageType: 'voice',
            isEdit: false,
            isReply: replyingTo ? true : false,
            duration: recordingTime,
            fileName: voiceLogMeta.fileName,
            fileSize: voiceLogMeta.fileSize,
            files: buildChatLogFiles(storedFiles),
            message: ' ',
            resetCycle: 0,
          },
        });
      }
    } catch (err) {
      console.warn('[Media] Failed to send voice note:', err);
      setMessages((prev: any[]) => prev.filter((m) => m._id !== tempId));
      Alert.alert('Error', 'Failed to send voice note. Please try again.');
    }
  };

  return {
    filteredMessages,
    searchQuery,
    setSearchQuery,
    replyingTo,
    setReplyingTo,
    editingMessage,
    setEditingMessage,
    showMentions,
    setShowMentions,
    composerText,
    setComposerText,
    composerTextRef,
    isKeyboardVisible,
    handleComposerChange,
    onSend,
    handleSend,
    handleAttach,
    handleDocumentAttach,
    sendGif,
    sendImageAsMessage,
    pendingAttachments,
    addPendingAppointmentPhotos,
    removePendingAttachment,
    handleSendVoiceNote,
    recordingState,
    recordingTime,
    recordedUri,
    startRecording,
    stopRecording,
    cancelRecording,
    reset,
    searchIndex,
    setSearchIndex,
    searchResults,
  };
};
