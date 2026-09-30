export async function requestNativeShare(navigatorObject, shareData) {
  if (typeof navigatorObject?.share !== 'function') return 'unavailable';

  try {
    await navigatorObject.share(shareData);
    return 'shared';
  } catch (error) {
    return error?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}
