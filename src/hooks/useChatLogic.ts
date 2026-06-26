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

  const handleAttach = useCallback(() => {
    launchImageLibrary({ mediaType: 'mixed', selectionLimit: 5 }, async (response) => {
      if (response.assets && chatId) {
        const assets = response.assets;
        if (user?._id) {
          const firstAsset = assets[0];
          const fileType = getWebMessageType({
            name: firstAsset?.fileName,
            type: firstAsset?.type,
          });

          logEvent('send', {
            user_id: user._id,
            module_type: isChannel ? 'team_channel' : 'chat',
            created_by: user._id,
            meta: {
              leadId,
              type: isChannel ? 'team_channel' : 'chat',
              isEdit: false,
              isReply: false,
              messageType: fileType,
              fileName: firstAsset?.fileName || 'Attachment',
              fileSize: firstAsset?.fileSize || 12000,
              message: '',
              action: 'sent an attachment',
            },
          });
        }
        const optimistics = assets.map((f) => {
          const isImg = f.type?.startsWith('image');
          return {
            _id: `temp_${Date.now()}_${Math.random()}`,
            text: isImg ? '' : f.fileName,
            image: isImg ? f.uri : undefined,
            createdAt: new Date(),
            user: { _id: String(currentUserId) },
            files: [
              { url: f.uri, name: f.fileName, mimeType: f.type, type: isImg ? 'image' : 'file' },
            ],
            pending: true,
            sent: false,
            received: false,
          };
        });
        setMessages((prev: any[]) => GiftedChat.append(prev, optimistics));
        try {
          await Promise.all(assets.map((f) =>
            ChatService.sendFileMessage(chatId, { uri: f.uri, name: f.fileName, type: f.type }, '')
          ));
        } catch (err: any) {
          console.warn('[Media] send failed:', err?.message || err);
          setMessages((prev: any[]) => prev.filter((m) => typeof m._id === 'string' && m._id.startsWith('temp_')));
          Alert.alert('Send Failed', 'Failed to send attachment. Please try again.');
        }
      }
    });
  }, [chatId, currentUserId, setMessages, user, leadId, isChannel]);

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
    handleAttach,
    handleDocumentAttach,
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
