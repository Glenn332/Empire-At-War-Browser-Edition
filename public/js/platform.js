export const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
