self.onmessage = async e => {
  const { id, bitmap } = e.data;
  try {
    const cv = new OffscreenCanvas(bitmap.width, bitmap.height);
    cv.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    self.postMessage({ id, blob: await cv.convertToBlob({ type: 'image/png' }) });
  } catch { self.postMessage({ id, blob: null }); }
};
