import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Keyboard, Platform, Alert } from 'react-native';
import { GiftedChat, IMessage } from 'react-native-gifted-chat';
import { launchImageLibrary } from 'react-native-image-picker';
import ChatService from '../services/api/ChatService';
import { useVoiceNote } from '../hooks/useVoiceNote';
import * as DocumentPicker from '@react-native-documents/picker';

export const useChatLogic = (
  chatId: string | null,
  messages: any[],
  setMessages: any,
  currentUserId: string,
  user: any,
  isChannel: boolean,
  participants: any[]
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
    setComposerText(text);
    composerTextRef.current = text;
    const lastWord = text.split(/\s/).pop() || '';
    setShowMentions(lastWord.startsWith('@'));
    if (chatId) ChatService.emitTyping(chatId, text.length > 0);
  };

  const onSend = useCallback(
    async (newMsgs: IMessage[] = []) => {
      if (!chatId) return;
      const raw = newMsgs[0];
      const tempId = `temp_${Date.now()}`;
      try {
        if (editingMessage) {
          const editedText = raw.text || composerText;
          setMessages((prev: any[]) =>
            prev.map((m) =>
              m._id === editingMessage._id ? { ...m, text: editedText, isEdited: true } : m
            )
          );
          await ChatService.editMessage(editingMessage._id, editedText);
          setEditingMessage(null);
        } else {
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
      } catch (err) {
        setMessages((prev: any[]) => prev.filter((m) => m._id !== tempId));
      } finally {
        setReplyingTo(null);
        setComposerText('');
        if (chatId) ChatService.emitTyping(chatId, false);
      }
    },
    [chatId, replyingTo, editingMessage, setMessages, currentUserId, user, composerText]
  );

  const handleAttach = useCallback(() => {
    launchImageLibrary({ mediaType: 'mixed', selectionLimit: 5 }, async (response) => {
      if (response.assets && chatId) {
        for (const f of response.assets) {
          const isImg = f.type?.startsWith('image');
          const optimistic = {
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
          setMessages((prev: any[]) => GiftedChat.append(prev, [optimistic]));
          await ChatService.sendFileMessage(
            chatId,
            { uri: f.uri, name: f.fileName, type: f.type },
            ''
          );
        }
      }
    });
  }, [chatId, currentUserId, setMessages]);

  const handleDocumentAttach = useCallback(async () => {
    try {
      const results = await DocumentPicker.pick({
        allowMultiSelection: true,
        type: [DocumentPicker.types.allFiles],
      });

      if (results && chatId) {
        for (const f of results) {
          const optimistic = {
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
          };
          setMessages((prev: any[]) => GiftedChat.append(prev, [optimistic]));
          await ChatService.sendFileMessage(
            chatId,
            { uri: f.uri, name: f.name, type: f.type },
            ''
          );
        }
      }
    } catch (err: any) {
      if (DocumentPicker.isErrorWithCode(err) && err.code === DocumentPicker.errorCodes.OPERATION_CANCELED) {
        return;
      }
      Alert.alert('Document Picker', 'Failed to pick document. Please try again.');
    }
  }, [chatId, currentUserId, setMessages]);

  const handleSendVoiceNote = async (uri: string) => {
    if (!uri || !chatId) return;
    console.log('[Media] Sending voice note:', uri);
    try {
      const fileName = uri.split('/').pop() || `voice_${Date.now()}.m4a`;
      const optimistic = {
        _id: `temp_${Date.now()}`,
        text: '🎤 Voice Note',
        createdAt: new Date(),
        user: { _id: String(currentUserId) },
        voice: uri,
        audio: uri,
        isVoiceNote: true,
        files: [{ url: uri, name: fileName, mimeType: 'audio/m4a', type: 'audio' }],
        pending: true,
        sent: false,
        received: false,
      };
      setMessages((prev: any[]) => GiftedChat.append(prev, [optimistic]));
      await ChatService.sendFileMessage(chatId, { uri, name: fileName, type: 'audio/m4a' }, '');
      reset();
    } catch (err) {}
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
