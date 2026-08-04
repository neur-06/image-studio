import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("pinaic", {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    save: (input: { apiKey: string; baseUrl: string; autoArchive?: boolean }) => ipcRenderer.invoke("settings:save", input),
    clear: () => ipcRenderer.invoke("settings:clear"),
    test: () => ipcRenderer.invoke("settings:test")
  },
  generate: (input: unknown) => ipcRenderer.invoke("image:generate", input),
  edit: (input: unknown) => ipcRenderer.invoke("image:edit", input),
  cancel: (requestId: string) => ipcRenderer.invoke("image:cancel", requestId),
  saveImage: (input: { dataUrl: string; suggestedName: string }) => ipcRenderer.invoke("image:save", input),
  gallery: {
    list: (input?: unknown) => ipcRenderer.invoke("gallery:list", input || {}),
    search: (input?: unknown) => ipcRenderer.invoke("gallery:search", input || {}),
    toggleFavorite: (id: string) => ipcRenderer.invoke("gallery:toggleFavorite", id),
    delete: (id: string) => ipcRenderer.invoke("gallery:delete", id),
    loadImage: (id: string) => ipcRenderer.invoke("gallery:loadImage", id)
  },
  templates: {
    list: () => ipcRenderer.invoke("templates:list"),
    save: (input: unknown) => ipcRenderer.invoke("templates:save", input),
    delete: (id: string) => ipcRenderer.invoke("templates:delete", id)
  },
  onProgress: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on("image:progress", listener);
    return () => ipcRenderer.removeListener("image:progress", listener);
  }
});
