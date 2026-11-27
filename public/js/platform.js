export const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const topFrame = () => typeof window === 'undefined' || window.top === window;

// WebKitGTK crashes in blobRegistry when a custom URI scheme request carries a Blob.
// Raw bytes follow its ordinary request-body stream instead of resolving a blob URL.
export const appRequestBody = async body => (inApp() && typeof Blob !== 'undefined' && body instanceof Blob ? body.arrayBuffer() : body);
