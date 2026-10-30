import {
  gifAspectRatio,
  isGifFile,
  isGifFileMessage,
  isGifMessageText,
} from '../../src/utils/gif-message';

// Two shapes mean one GIF: the GIPHY URL as the body (every message stored before the server kept
// its own copy, and this app's optimistic bubble) and the stored one-file message. Getting either
// wrong shows a raw link, or draws a GIF as a cropped still — neither throws.

const GIPHY = 'https://media0.giphy.com/media/v1.Y2lkPTZj/H5C8CevNMbpBqNqFjl/200.gif';

describe('isGifMessageText', () => {
  it('matches a GIPHY media URL that is the whole body', () => {
    expect(isGifMessageText(GIPHY)).toBe(true);
    expect(isGifMessageText(`  ${GIPHY}  `)).toBe(true);
  });

  it('leaves a sentence containing a link as text', () => {
    expect(isGifMessageText(`look ${GIPHY}`)).toBe(false);
    expect(isGifMessageText('')).toBe(false);
    expect(isGifMessageText(null)).toBe(false);
  });
});

describe('isGifFile', () => {
  it('takes what the server stores a picked GIF as', () => {
    expect(isGifFile({ type: 'image/gif' })).toBe(true);
    expect(isGifFile({ fileType: 'image/gif' })).toBe(true);
    expect(isGifFile({ name: 'abc-200.gif' })).toBe(true);
    expect(
      isGifFile({ mimeType: 'image/webp', filePath: 'chat/c1/ch1/gifs/1-abc.webp' })
    ).toBe(true);
  });

  it('leaves a photo alone, animated extension or not', () => {
    expect(isGifFile({ type: 'image/jpeg', name: 'front.jpg' })).toBe(false);
    // A WebP photo is not a GIF: it must keep the photo bubble and its lightbox.
    expect(isGifFile({ type: 'image/webp', filePath: 'chat/c1/ch1/files/1-front.webp' })).toBe(
      false
    );
    expect(isGifFile(undefined)).toBe(false);
  });
});

describe('isGifFileMessage', () => {
  const gif = { fileType: 'image/gif', filePath: 'chat/c1/ch1/gifs/1-abc-200.gif' };

  it('is true for the captionless one-GIF message the server writes', () => {
    expect(isGifFileMessage({ text: '', files: [gif] })).toBe(true);
    // The body is stored as a single space, like any captionless upload.
    expect(isGifFileMessage({ message: ' ', files: [gif] })).toBe(true);
  });

  it('is false once there are words, more files, or no GIF', () => {
    expect(isGifFileMessage({ text: 'look at this', files: [gif] })).toBe(false);
    expect(isGifFileMessage({ text: '', files: [gif, gif] })).toBe(false);
    expect(isGifFileMessage({ text: '', files: [{ fileType: 'image/jpeg' }] })).toBe(false);
    expect(isGifFileMessage({ text: GIPHY })).toBe(false);
    expect(isGifFileMessage(undefined)).toBe(false);
  });
});

describe('gifAspectRatio', () => {
  it('clamps so a bubble never collapses or explodes', () => {
    expect(gifAspectRatio(200, 100)).toBe(2);
    expect(gifAspectRatio(1000, 10)).toBe(2.5);
    expect(gifAspectRatio(10, 1000)).toBe(0.5);
    expect(gifAspectRatio(0, 0)).toBe(1);
    expect(gifAspectRatio(undefined, undefined)).toBe(1);
  });
});
