let handle = null;
onmessage = async ({ data }) => {
  try {
    if (data.open) {
      let dir = await navigator.storage.getDirectory();
      for (const part of data.open) dir = await dir.getDirectoryHandle(part, { create: true });
      handle = await (await dir.getFileHandle(data.name, { create: true })).createSyncAccessHandle();
      handle.truncate(0);
    } else if (data.chunk) {
      const bytes = new Uint8Array(data.chunk);
      for (let n = 0; n < bytes.length; ) {
        const k = handle.write(bytes.subarray(n), { at: data.at + n });
        if (!(k > 0 && k <= bytes.length - n))
          throw new Error(`Could not write to the browser's storage at ${data.at + n} bytes (is the disk full?)`);
        n += k;
      }
    } else if (data.close) {
      if (handle) {
        handle.flush();
        handle.close();
        handle = null;
      }
    }
    postMessage({ id: data.id });
  } catch (e) {
    postMessage({
      id: data.id,
      error: (e && e.name === 'QuotaExceededError' ? 'QuotaExceededError: ' : '') + ((e && e.message) || String(e))
    });
  }
};
