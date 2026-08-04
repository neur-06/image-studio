export {};

declare global {
  interface Window {
    pinaic: {
      settings: {
        get: () => Promise<{ configured: boolean; baseUrl: string; autoArchive: boolean }>;
        save: (input: { apiKey: string; baseUrl: string; autoArchive?: boolean }) => Promise<{ ok: boolean }>;
        clear: () => Promise<{ ok: boolean }>;
        test: () => Promise<{ ok: boolean; message: string }>;
      };
      generate: (input: unknown) => Promise<ApiResult>;
      edit: (input: unknown) => Promise<ApiResult>;
      cancel: (requestId: string) => Promise<void>;
      saveImage: (input: { dataUrl: string; suggestedName: string }) => Promise<{ canceled: boolean; path?: string }>;
      gallery: {
        list: (input?: unknown) => Promise<{ ok: boolean; items: GalleryItem[]; error?: string }>;
        search: (input?: unknown) => Promise<{ ok: boolean; items: GalleryItem[]; error?: string }>;
        toggleFavorite: (id: string) => Promise<{ ok: boolean; item?: GalleryItem; error?: string }>;
        delete: (id: string) => Promise<{ ok: boolean; error?: string }>;
        loadImage: (id: string) => Promise<{ ok: boolean; b64?: string; error?: string }>;
      };
      templates: {
        list: () => Promise<{ ok: boolean; items: PromptTemplate[] }>;
        save: (input: unknown) => Promise<{ ok: boolean; item?: PromptTemplate; error?: string }>;
        delete: (id: string) => Promise<{ ok: boolean; error?: string }>;
      };
      onProgress: (callback: (event: AppProgress) => void) => () => void;
    };
  }

  interface AppProgress { requestId: string; progress?: number; status: string; message?: string }
  interface ApiImage { b64_json?: string; url?: string }
  interface ApiResult { ok: boolean; images?: ApiImage[]; gallery?: GalleryItem[]; error?: string; requestId?: string }
  interface GalleryItem { id: string; fileName: string; prompt: string; model: string; size: string; quality?: string; ratio?: string; resolution?: string; mode: "generate" | "edit"; createdAt: string; favorite: boolean }
  interface PromptTemplate { id: string; title: string; category: string; prompt: string; ratio?: string; resolution?: string; quality?: string; builtin?: boolean }
}
