self.onmessage = async e => {
  const { id, url } = e.data;
  try {
    const r = await fetch(url);
    if (!r.ok || r.status === 204) {
      postMessage({ id, buf: null });
      return;
    }
    const buf = await r.arrayBuffer();
    postMessage({ id, buf }, [buf]);
  } catch (err) {
    postMessage({ id, error: String((err && err.message) || err) + ': ' + url });
  }
};
