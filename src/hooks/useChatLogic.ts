import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Keyboard, Platform, Alert } from 'react-native';
import { GiftedChat, IMessage } from 'react-native-gifted-chat';
import { launchImageLibrary } from 'react-native-image-picker';
import ChatService from '../services/api/ChatService';
import { useVoiceNote } from '../hooks/useVoiceNote';
import * as DocumentPicker from '@react-native-documents/picker';
import { logEvent } from '../services/api/LoggerService';
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

  // Attachments staged in the composer (previews) — sent on the main Send, with
  // the images uploaded BEFORE the typed message. Mirrors the web MessageInput
  // (`files` + `pendingAppointmentPhotos`).
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
          await ChatService.editMessage(editingMessage._id, editedText);
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

  // Pick gallery images/videos and STAGE them as composer previews (not sent
  // until the main Send — so a caption can be added first). Web parity.
  const handleAttach = useCallback(() => {
    launchImageLibrary({ mediaType: 'mixed', selectionLimit: 5 }, (response) => {
      if (!response.assets?.length) return;
      setPendingAttachments((prev) => [
        ...prev,
        ...response.assets!.map((f, i) => ({
          id: `gal_${Date.now()}_${i}_${Math.random()}`,
          kind: 'gallery' as const,
          asset: { uri: f.uri, fileName: f.fileName, type: f.type },
          previewUri: f.uri,
          isImage: !!f.type?.startsWith('image'),
        })),
      ]);
    });
  }, []);

  // Upload staged gallery assets as ONE message carrying all files — so a batch
  // selected together renders as a single WhatsApp-style grid (same as
  // appointment photos), not one bubble per photo. Optimistic bubble renders
  // instantly from the local uris.
  const sendGalleryAssets = useCallback(
    async (
      assets: Array<{ uri?: string; fileName?: string; type?: string }>,
      reply?: any
    ) => {
      if (!assets?.length || !chatId) return;
      if (user?._id) {
        const first = assets[0];
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
            message: '',
            action: `sent ${assets.length} attachment(s)`,
          },
        });
      }
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
        // Top-level image only helps the single-image render path.
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
        await ChatService.sendFilesMessage(
          chatId,
          assets.map((f) => ({ uri: f.uri, name: f.fileName, type: f.type })),
          '',
          reply?._id
        );
      } catch (err: any) {
        console.warn('[Media] send failed:', err?.message || err);
        setMessages((prev: any[]) => prev.filter((m) => m._id !== tempId));
        Alert.alert('Send Failed', 'Failed to send attachment. Please try again.');
      }
    },
    [chatId, currentUserId, setMessages, user, leadId, isChannel]
  );

  // Send a single image (local OR remote) as a chat message. Used by the
  // "Annotated Photos" picker, whose images are remote signed S3 URLs.
  // Remote images must be downloaded to a local file first — React Native's
  // FormData multipart engine cannot read an http(s) URL as a file (see
  // ChatService.sendFileMessage, which passes http URIs through untouched).
  const sendImageAsMessage = useCallback(
    async (uri: string, fileName = 'Photo') => {
      if (!uri || !chatId) return;
      const tempId = `temp_${Date.now()}_${Math.random()}`;
      const safeName = /\.(jpe?g|png|gif|webp)$/i.test(fileName) ? fileName : `${fileName}.jpg`;

      if (user?._id) {
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
            fileSize: 12000,
            message: '',
            action: 'sent an attachment',
          },
        });
      }

      // Optimistic bubble uses the (remote) uri directly so it renders instantly.
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
        // Remote images must be downloaded locally before the multipart upload.
        if (/^https?:\/\//i.test(uri)) {
          const localPath = `${RNFS.CachesDirectoryPath}/chat_photo_${Date.now()}.jpg`;
          const { statusCode } = await RNFS.downloadFile({ fromUrl: uri, toFile: localPath }).promise;
          if (statusCode && statusCode >= 200 && statusCode < 300) {
            uploadUri = localPath;
          } else {
            throw new Error(`Download failed with status ${statusCode}`);
          }
        }
        await ChatService.sendFileMessage(chatId, { uri: uploadUri, name: safeName, type: 'image/jpeg' }, '');
      } catch (err: any) {
        console.warn('[Media] annotated photo send failed:', err?.message || err);
        setMessages((prev: any[]) => prev.filter((m) => m._id !== tempId));
        Alert.alert('Send Failed', 'Failed to send photo. Please try again.');
      }
    },
    [chatId, currentUserId, setMessages, user, leadId, isChannel]
  );

  // Send multiple appointment photos (the lead's sales photos) as ONE message.
  // These already live in S3, so we send their references — NOT re-uploads —
  // exactly like the web (MessageInput.handleSend). A single bubble carries all
  // selected photos and renders as a WhatsApp-style grid (see ChatMessageBubble).
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
        // Human caption ("Front of Home") the chat grid shows under the photo.
        // Stored as BOTH subcategory and (base of) fileName so it survives even
        // if the server echoes only one of them back on reload.
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

      if (user?._id) {
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
            message: '',
            action: `sent ${filesPayload.length} appointment photo(s)`,
          },
        });
      }

      // Optimistic bubble — all photos in one message. `previewUrl` carries the
      // already-signed URL so the grid shows instantly before the server echo.
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
          // Web parity (ChatModule optimisticPhoto): the already-signed URL goes in
          // BOTH `url` and `previewUrl` so the grid renders instantly (getGridSrc reads
          // `url`; the display keys off the picker's resolved link, no fetch needed).
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
        await ChatService.sendAppointmentPhotos(chatId, filesPayload, ' ', reply?._id);
      } catch (err: any) {
        console.warn('[Media] appointment photos send failed:', err?.message || err);
        setMessages((prev: any[]) => prev.filter((m) => m._id !== tempId));
        Alert.alert('Send Failed', 'Failed to send photos. Please try again.');
      }
    },
    [chatId, currentUserId, setMessages, user, leadId, isChannel]
  );

  // Send a plain text message (optimistic + REST). Extracted so the unified
  // send can fire it AFTER the staged images have uploaded.
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
        await ChatService.sendMessageREST({ chatId, message: text, replyTo: reply?._id });
      } catch {
        setMessages((prev: any[]) => prev.filter((m) => m._id !== tempId));
      }
    },
    [chatId, currentUserId, user, setMessages, isChannel, leadId]
  );

  // Unified send for the composer's Send button: flush any staged attachments
  // (images upload FIRST, per product spec), then send the typed message. Also
  // handles the edit case (text-only).
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
        await ChatService.editMessage(editingMessage._id, editedText);
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

    // Clear the composer immediately for a snappy feel.
    setPendingAttachments([]);
    setComposerText('');
    composerTextRef.current = '';
    setReplyingTo(null);
    if (chatId) {
      if (isChannel) ChatService.emitChannelTyping(chatId, false);
      else ChatService.emitTyping(chatId, false);
    }

    try {
      // Images upload FIRST, then the message (per product spec / screenshot).
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

  const handleDocumentAttach = useCallback(async () => {
    try {
      const results = await DocumentPicker.pick({
        allowMultiSelection: true,
        type: [DocumentPicker.types.allFiles],
      });

      if (results && chatId) {
        const docs = results;
        if (user?._id) {
          const firstDoc = docs[0];
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
              fileName: firstDoc?.name || 'Document',
              fileSize: firstDoc?.size || 12000,
              message: '',
              action: 'sent an attachment',
            },
          });
        }
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
        await Promise.all(docs.map((f) =>
          ChatService.sendFileMessage(chatId, { uri: f.uri, name: f.name, type: f.type }, '')
        ));
      }
    } catch (err: any) {
      if (DocumentPicker.isErrorWithCode(err) && err.code === DocumentPicker.errorCodes.OPERATION_CANCELED) {
        return;
      }
      console.warn('[Document] send failed:', err?.message || err);
      // Remove optimistic messages on failure
      setMessages((prev: any[]) => prev.filter((m) => typeof m._id === 'string' && m._id.startsWith('temp_')));
      Alert.alert('Send Failed', 'Failed to send document. Please try again.');
    }
  }, [chatId, currentUserId, setMessages, user, leadId, isChannel]);

  const handleSendVoiceNote = async (uri: string) => {
    if (!uri || !chatId) return;
    console.log('[Media] Sending voice note:', uri);
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

      logEvent('send', {
        user_id: user._id,
        module_type: isChannel ? 'team_channel' : 'chat',
        created_by: user._id,
        meta: {
          leadId,
          type: isChannel ? 'team_channel' : 'chat',
          action: 'Sent voice memo',
          messageType: 'voice',
          isReply: replyingTo ? true : false,
          duration: recordingTime,
          fileName,
          fileSize,
        },
      });
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

      // Instantly clear the recorder/player and hide the sending bar
      reset();

      // Add the optimistic voice note to the message list instantly
      setMessages((prev: any[]) => GiftedChat.append(prev, [optimistic]));

      // Execute the API send in the background
      await ChatService.sendFileMessage(chatId, { uri, name: fileName, type: 'audio/m4a' }, '');
    } catch (err) {
      console.warn('[Media] Failed to send voice note:', err);
      // Clean up the optimistic message from list on failure
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
