/**
 * What "Download" can actually do right now, decided BEFORE any network call.
 *
 * ⚠️ The photos are already on disk. `usePrecacheLeadPhotos` warms every sales photo on the
 * lead into `imageFileCache` while the rep is online, and `getLocalCachePath` deliberately
 * drops the S3 query string - so a re-signed URL still resolves to the same cached file.
 * Downloading therefore does not need the network; it needs a cache LOOKUP, which the old
 * code never attempted. It went straight to `.fetch('GET', url)` and failed offline with
 * "Failed to download photos", standing on top of the bytes it wanted.
 *
 * Pure so it can be tested: anything importing the real cache pulls in blob-util, which
 * cannot load under jest (CLAUDE.md §6). The caller injects the lookup.
 */

export interface PhotoDownloadItem {
  /** The URI as the screen knows it - remote, or already local. */
  uri: string;
}

export interface PhotoDownloadPlan<T> {
  /** Ready from disk now; no network needed. */
  local: T[];
  /** Only obtainable over the network. */
  remote: T[];
}

const isLocalUri = (uri: string): boolean =>
  uri.startsWith('file://') || uri.startsWith('/');

/**
 * Split the set into what the device already has and what it would have to fetch.
 *
 * `resolveCached` is the synchronous warmed-path lookup (`getWarmedLocalUri`). It returning
 * null means "not warmed in memory", which is not the same as "not on disk" - the caller may
 * still probe the filesystem for the stragglers.
 */
export const planPhotoDownload = <T extends PhotoDownloadItem>(
  items: T[],
  resolveCached: (uri: string) => string | null
): PhotoDownloadPlan<T> => {
  const local: T[] = [];
  const remote: T[] = [];
  for (const item of items) {
    const uri = item?.uri;
    if (!uri) continue;
    if (isLocalUri(uri) || resolveCached(uri)) local.push(item);
    else remote.push(item);
  }
  return { local, remote };
};

/**
 * What to tell the rep before starting, when they are offline.
 *
 * ⚠️ Never refuse outright while SOME photos are available. A rep at a door who can save six
 * of eight photos wants those six; an all-or-nothing refusal is the app choosing tidiness
 * over the rep's actual job.
 */
export interface OfflineDownloadNotice {
  kind: 'none' | 'partial' | 'blocked';
  title: string;
  message: string;
}

export const offlineDownloadNotice = (
  localCount: number,
  remoteCount: number
): OfflineDownloadNotice => {
  if (remoteCount === 0) return { kind: 'none', title: '', message: '' };
  if (localCount === 0) {
    return {
      kind: 'blocked',
      title: 'No saved photos',
      message:
        "These photos haven't been opened on this device yet, so there's nothing saved to download. Connect and try again.",
    };
  }
  return {
    kind: 'partial',
    title: 'Some photos need a connection',
    message: `${localCount} of ${localCount + remoteCount} photos are saved on this device and can be downloaded now. The rest need a connection.`,
  };
};

/** The closing message, so the counts never disagree with what actually landed. */
export const downloadResultMessage = (
  saved: number,
  attempted: number,
  skippedOffline: number
): { title: string; message: string } => {
  if (saved === 0) {
    return { title: 'Error', message: 'Failed to download photos. Please try again.' };
  }
  if (saved === attempted && skippedOffline === 0) {
    return {
      title: 'Success',
      message: `Successfully downloaded all ${saved} photos to your gallery!`,
    };
  }
  const tail = skippedOffline > 0 ? ` ${skippedOffline} need a connection.` : '';
  return {
    title: 'Partial Download',
    message: `Downloaded ${saved} of ${attempted + skippedOffline} photos.${tail}`,
  };
};
