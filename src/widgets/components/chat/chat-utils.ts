export const getFileType = (file: any) => {
  if (!file) return 'text';
  const name = (file.name || file.fileName || file.url || file.path || '').toLowerCase();
  const mime = (file.mimeType || file.type || '').toLowerCase();
  const ext = name.split('.').pop()?.toLowerCase();

  if (mime.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'flac'].includes(ext))
    return 'audio';
  if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'avi'].includes(ext)) return 'video';
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext))
    return 'image';
  if (mime.includes('pdf') || ext === 'pdf') return 'pdf';
  if (mime.includes('excel') || mime.includes('spreadsheet') || ext === 'xls' || ext === 'xlsx')
    return 'xls';
  if (mime.includes('word') || ext === 'doc' || ext === 'docx') return 'word';
  return 'file';
};

export const stringToColor = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  let color = '#';
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xff;
    color += ('00' + value.toString(16)).substr(-2);
  }
  return color;
};

export const getAvatarProps = (user: any, isMe: boolean) => {
  const name = user?.name || 'User';
  const color = user?.colorCode || stringToColor(user?._id || user?.id || name);
  const initials = name
    .split(' ')
    .filter(Boolean)
    .map((n: string) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
  return { name, color, initials };
};

export const getNativeModules = () => {
  try {
    return {
      ReactNativeBlobUtil: require('react-native-blob-util').default,
      FileViewer: require('react-native-file-viewer').default,
      CameraRoll: require('@react-native-camera-roll/camera-roll').CameraRoll,
      Video: require('react-native-video').default,
    };
  } catch (e) {
    return { ReactNativeBlobUtil: null, FileViewer: null, CameraRoll: null, Video: null };
  }
};

export const cleanFilePath = (p: string) => {
  if (!p) return '';
  let cleaned = p.replace(/^(file:\/\/|content:\/\/|data:)/, '');

  // Extract path from S3 URL if present
  if (cleaned.includes('amazonaws.com/')) {
    cleaned = cleaned.substring(cleaned.indexOf('amazonaws.com/') + 14);
  }

  const roots = ['chat/', 'leads/', 'files/', 'customer/', 'revdsm/', 'voice-notes/'];
  for (const r of roots) {
    if (cleaned.includes(r)) return cleaned.substring(cleaned.indexOf(r));
  }
  return cleaned.replace(/^\/+/, '');
};
