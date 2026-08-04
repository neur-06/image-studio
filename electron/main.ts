import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import keytar from "keytar";

const SERVICE = "pinaic-image-studio";
const ACCOUNT = "default";
const DEFAULT_BASE_URL = "https://api.pinaic.com/v1";
const DEFAULT_SAVE_DIR = "D:\\codexproject\\生图\\保存图片";
const controllers = new Map<string, AbortController>();

type RequestInput = { requestId: string; prompt: string; model: string; size: string; n: number; quality?: string; ratio?: string; resolution?: string };
type EditInput = RequestInput & { image: { name: string; type: string; data: number[] }; mask?: { name: string; type: string; data: number[] } };
type GalleryRecord = { id: string; fileName: string; prompt: string; model: string; size: string; quality?: string; ratio?: string; resolution?: string; mode: "generate" | "edit"; createdAt: string; favorite: boolean };
type PromptTemplate = { id: string; title: string; category: string; prompt: string; ratio?: string; resolution?: string; quality?: string; builtin?: boolean };
const DEFAULT_TEMPLATES: PromptTemplate[] = [
  { id: "builtin-poster", title: "科技产品海报", category: "海报", prompt: "一张高级科技感产品海报，主体清晰突出，蓝紫与粉色渐变光效，留出标题和副标题空间，商业广告级构图", ratio: "4:5", resolution: "2k", quality: "high", builtin: true },
  { id: "builtin-cover", title: "内容平台封面", category: "封面", prompt: "一张适合内容平台封面的视觉主图，主题明确，主体醒目，画面干净，保留适合叠加标题的留白区域", ratio: "16:9", resolution: "2k", quality: "high", builtin: true },
  { id: "builtin-product", title: "产品展示图", category: "产品", prompt: "专业产品摄影，主体居中，干净高级的棚拍光线，细腻材质，简洁背景，无品牌文字和水印", ratio: "1:1", resolution: "2k", quality: "high", builtin: true },
  { id: "builtin-social", title: "社交媒体配图", category: "社交媒体", prompt: "一张适合社交媒体发布的吸睛视觉，主体明确，色彩明快，构图平衡，细节丰富但画面不拥挤", ratio: "9:16", resolution: "1k", quality: "medium", builtin: true }
];
const galleryDir = path.join(DEFAULT_SAVE_DIR, "图库");
const galleryIndex = path.join(galleryDir, "index.json");

async function readGallery(): Promise<GalleryRecord[]> {
  try { const raw = await fs.readFile(galleryIndex, "utf8"); const value = JSON.parse(raw); return Array.isArray(value) ? value : []; } catch { return []; }
}
async function writeGallery(items: GalleryRecord[]) {
  await fs.mkdir(galleryDir, { recursive: true });
  await fs.writeFile(galleryIndex, JSON.stringify(items, null, 2), "utf8");
}
function galleryPath(item: GalleryRecord) { return path.join(galleryDir, path.basename(item.fileName)); }
async function archiveImages(images: ApiImage[], input: RequestInput | EditInput, enabled: boolean) {
  if (!enabled) return [] as GalleryRecord[];
  const records = await readGallery(); await fs.mkdir(galleryDir, { recursive: true }); const created: GalleryRecord[] = [];
  for (const image of images) {
    if (!image.b64_json) continue;
    const id = randomUUID(); const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${id}.png`;
    const base64 = image.b64_json.replace(/^data:image\/\w+;base64,/, "");
    await fs.writeFile(path.join(galleryDir, fileName), Buffer.from(base64, "base64"));
    created.push({ id, fileName, prompt: input.prompt, model: input.model, size: input.size, quality: input.quality, ratio: input.ratio, resolution: input.resolution, mode: "image" in input ? "edit" : "generate", createdAt: new Date().toISOString(), favorite: false });
  }
  await writeGallery([...created, ...records]); return created;
}
async function templatesFile() { return path.join(app.getPath("userData"), "pinaic-image-templates.json"); }
async function readCustomTemplates(): Promise<PromptTemplate[]> { try { const raw = await fs.readFile(await templatesFile(), "utf8"); const value = JSON.parse(raw); return Array.isArray(value) ? value : []; } catch { return []; } }

function createWindow() {
  const win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 980, minHeight: 680,
    backgroundColor: "#f7f8fc",
    icon: path.join(__dirname, "../PinAI Image Studio.ico"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false }
  });
  if (process.argv.includes("--dev")) win.loadURL(process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173");
  else win.loadFile(path.join(__dirname, "../dist/index.html"));
}

async function config() {
  const archiveSetting = await keytar.getPassword(SERVICE, `${ACCOUNT}:autoArchive`);
  return { apiKey: await keytar.getPassword(SERVICE, ACCOUNT), baseUrl: (await keytar.getPassword(SERVICE, `${ACCOUNT}:baseUrl`)) || DEFAULT_BASE_URL, autoArchive: archiveSetting !== "false" };
}

function emit(win: BrowserWindow, requestId: string, status: string, progress?: number, message?: string) {
  win.webContents.send("image:progress", { requestId, status, progress, message });
}

async function parseResponse(response: Response, win: BrowserWindow, requestId: string): Promise<ApiImage[]> {
  const type = response.headers.get("content-type") || "";
  if (!response.body) throw new Error("接口没有返回内容");
  if (!type.includes("text/event-stream")) {
    const json = await response.json() as { data?: ApiImage[] };
    return json.data || [];
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const images: ApiImage[] = [];
  const consume = (raw: string) => {
    const line = raw.trim();
    if (!line.startsWith("data:")) return;
    const value = line.slice(5).trim();
    if (!value || value === "[DONE]") return;
    try {
      const payload = JSON.parse(value) as { data?: ApiImage[]; images?: ApiImage[]; progress?: number; status?: string; message?: string; b64_json?: string };
      if (payload.data) images.push(...payload.data);
      if (payload.images) images.push(...payload.images);
      if (payload.b64_json) images.push({ b64_json: payload.b64_json });
      emit(win, requestId, payload.status || "生成中", payload.progress, payload.message);
    } catch { /* ignore non-JSON keepalive events */ }
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/); buffer = lines.pop() || "";
    lines.forEach(consume);
    if (done) break;
  }
  if (buffer) consume(buffer);
  return images;
}

async function callImages(win: BrowserWindow, endpoint: "generations" | "edits", input: RequestInput | EditInput) {
  const { apiKey, baseUrl } = await config();
  if (!apiKey) throw new Error("请先在设置中保存 PinAI API 密钥");
  const controller = new AbortController(); controllers.set(input.requestId, controller);
  const timer = setTimeout(() => controller.abort(), 300_000);
  try {
    emit(win, input.requestId, "已提交", 0);
    let response: Response;
    if (endpoint === "generations") {
      const body: Record<string, unknown> = { model: input.model, prompt: input.prompt, size: input.size, n: input.n, response_format: "b64_json", stream: true };
      if (input.quality && input.quality !== "auto") body.quality = input.quality;
      response = await fetch(`${baseUrl.replace(/\/$/, "")}/images/generations`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    } else {
      const edit = input as EditInput;
      const form = new FormData();
      form.append("model", edit.model); form.append("prompt", edit.prompt); form.append("size", edit.size); form.append("n", String(edit.n)); form.append("response_format", "b64_json"); form.append("stream", "true");
      if (edit.quality && edit.quality !== "auto") form.append("quality", edit.quality);
      form.append("image", new Blob([Buffer.from(edit.image.data)], { type: edit.image.type || "application/octet-stream" }), edit.image.name);
      if (edit.mask) form.append("mask", new Blob([Buffer.from(edit.mask.data)], { type: edit.mask.type || "application/octet-stream" }), edit.mask.name);
      response = await fetch(`${baseUrl.replace(/\/$/, "")}/images/edits`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: controller.signal });
    }
    if (!response.ok) { const text = await response.text(); throw new Error(`PinAI ${response.status}: ${text.slice(0, 500)}`); }
    const parsedImages = await parseResponse(response, win, input.requestId);
    const seen = new Set<string>();
    const images = parsedImages.filter(image => {
      const key = image.b64_json || image.url;
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, input.n);
    if (!images.length) throw new Error("接口未返回图片数据");
    emit(win, input.requestId, "完成", 100);
    const settings = await config();
    const gallery = await archiveImages(images, input, settings.autoArchive);
    return { ok: true, images, gallery, requestId: input.requestId };
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error("请求已取消或超过 300 秒超时");
    const message = (error as Error).message || "生成失败";
    if (/quality/i.test(message) && /(unsupported|unknown|invalid|不支持)/i.test(message)) throw new Error(`PinAI 不支持当前清晰度参数，请切换为“自动”后重试。\n${message}`);
    throw error;
  } finally { clearTimeout(timer); controllers.delete(input.requestId); }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "文件", submenu: [{ label: "关闭窗口", role: "close" }] },
    { label: "编辑", submenu: [
      { label: "撤销", role: "undo" }, { label: "重做", role: "redo" }, { type: "separator" },
      { label: "剪切", role: "cut" }, { label: "复制", role: "copy" }, { label: "粘贴", role: "paste" }, { label: "全选", role: "selectAll" }
    ] },
    { label: "查看", submenu: [
      { label: "重新加载", role: "reload" }, { label: "强制重新加载", role: "forceReload" },
      { label: "开发者工具", role: "toggleDevTools" }, { type: "separator" },
      { label: "实际大小", role: "resetZoom" }, { label: "放大", role: "zoomIn" }, { label: "缩小", role: "zoomOut" },
      { type: "separator" }, { label: "全屏", role: "togglefullscreen" }
    ] },
    { label: "窗口", submenu: [{ label: "最小化", role: "minimize" }, { label: "关闭", role: "close" }] },
    { label: "帮助", submenu: [{ label: "PinAI Image Studio 使用说明", click: () => dialog.showMessageBox({ type: "info", title: "PinAI Image Studio", message: "本地 PinAI 图片生成工具\n支持文生图、图片编辑、比例与 1K/2K/4K 清晰度选择。" }) }] }
  ]));
  ipcMain.handle("settings:get", async () => { const c = await config(); return { configured: Boolean(c.apiKey), baseUrl: c.baseUrl, autoArchive: c.autoArchive }; });
  ipcMain.handle("settings:save", async (_e, value: { apiKey: string; baseUrl: string; autoArchive?: boolean }) => { if (value.apiKey.trim()) await keytar.setPassword(SERVICE, ACCOUNT, value.apiKey.trim()); await keytar.setPassword(SERVICE, `${ACCOUNT}:baseUrl`, value.baseUrl.trim() || DEFAULT_BASE_URL); await keytar.setPassword(SERVICE, `${ACCOUNT}:autoArchive`, value.autoArchive === false ? "false" : "true"); return { ok: true }; });
  ipcMain.handle("settings:clear", async () => { await keytar.deletePassword(SERVICE, ACCOUNT); return { ok: true }; });
  ipcMain.handle("settings:test", async () => { const c = await config(); if (!c.apiKey) return { ok: false, message: "尚未配置 API 密钥" }; try { const r = await fetch(`${c.baseUrl.replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${c.apiKey}` }, signal: AbortSignal.timeout(20_000) }); return r.ok ? { ok: true, message: "连接成功" } : { ok: false, message: `接口返回 ${r.status}` }; } catch (e) { return { ok: false, message: (e as Error).message }; } });
  ipcMain.handle("image:generate", (e, input: RequestInput) => callImages(BrowserWindow.fromWebContents(e.sender)!, "generations", input));
  ipcMain.handle("image:edit", (e, input: EditInput) => callImages(BrowserWindow.fromWebContents(e.sender)!, "edits", input));
  ipcMain.handle("image:cancel", async (_e, requestId: string) => { controllers.get(requestId)?.abort(); });
  ipcMain.handle("image:save", async (_e, value: { dataUrl: string; suggestedName: string }) => {
    await fs.mkdir(DEFAULT_SAVE_DIR, { recursive: true });
    const result = await dialog.showSaveDialog({ defaultPath: path.join(DEFAULT_SAVE_DIR, value.suggestedName || `pinaic-${Date.now()}.png`), filters: [{ name: "PNG 图片", extensions: ["png"] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    const base64 = value.dataUrl.replace(/^data:image\/\w+;base64,/, ""); await fs.writeFile(result.filePath, Buffer.from(base64, "base64")); return { canceled: false, path: result.filePath };
  });
  ipcMain.handle("gallery:list", async () => ({ ok: true, items: await readGallery() }));
  ipcMain.handle("gallery:search", async (_e, input: { query?: string; favoriteOnly?: boolean; sort?: "newest" | "oldest" }) => {
    let items = await readGallery(); const query = (input?.query || "").trim().toLowerCase();
    if (query) items = items.filter(item => item.prompt.toLowerCase().includes(query) || item.model.toLowerCase().includes(query) || item.size.toLowerCase().includes(query));
    if (input?.favoriteOnly) items = items.filter(item => item.favorite);
    items.sort((a, b) => input?.sort === "oldest" ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt));
    return { ok: true, items };
  });
  ipcMain.handle("gallery:toggleFavorite", async (_e, id: string) => { const items = await readGallery(); const item = items.find(value => value.id === id); if (!item) return { ok: false, error: "图库记录不存在" }; item.favorite = !item.favorite; await writeGallery(items); return { ok: true, item }; });
  ipcMain.handle("gallery:delete", async (_e, id: string) => { const items = await readGallery(); const item = items.find(value => value.id === id); if (!item) return { ok: false, error: "图库记录不存在" }; await fs.rm(galleryPath(item), { force: true }); await writeGallery(items.filter(value => value.id !== id)); return { ok: true }; });
  ipcMain.handle("gallery:loadImage", async (_e, id: string) => { const item = (await readGallery()).find(value => value.id === id); if (!item) return { ok: false, error: "图库记录不存在" }; try { return { ok: true, b64: (await fs.readFile(galleryPath(item))).toString("base64") }; } catch { return { ok: false, error: "图片文件不存在" }; } });
  ipcMain.handle("templates:list", async () => ({ ok: true, items: [...DEFAULT_TEMPLATES, ...(await readCustomTemplates())] }));
  ipcMain.handle("templates:save", async (_e, input: Partial<PromptTemplate>) => { if (!input.title?.trim() || !input.prompt?.trim()) return { ok: false, error: "模板标题和提示词不能为空" }; const items = await readCustomTemplates(); const item: PromptTemplate = { id: input.id && !input.id.startsWith("builtin-") ? input.id : `custom-${randomUUID()}`, title: input.title.trim(), category: input.category?.trim() || "自定义", prompt: input.prompt.trim(), ratio: input.ratio, resolution: input.resolution, quality: input.quality }; const next = [...items.filter(value => value.id !== item.id), item]; await fs.mkdir(path.dirname(await templatesFile()), { recursive: true }); await fs.writeFile(await templatesFile(), JSON.stringify(next, null, 2), "utf8"); return { ok: true, item }; });
  ipcMain.handle("templates:delete", async (_e, id: string) => { if (id.startsWith("builtin-")) return { ok: false, error: "内置模板不能删除" }; const items = await readCustomTemplates(); await fs.writeFile(await templatesFile(), JSON.stringify(items.filter(item => item.id !== id), null, 2), "utf8"); return { ok: true }; });
  createWindow(); app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

type ApiImage = { b64_json?: string; url?: string };
