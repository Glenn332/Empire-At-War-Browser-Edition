export const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const topFrame = () => typeof window === 'undefined' || window.top === window;
