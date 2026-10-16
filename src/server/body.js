import { ContentError } from '../admin/content-model.js';

export async function readBytes(request, maxBytes) {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new ContentError('上传内容超过允许大小。', 413, 'payload_too_large');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new ContentError('上传内容超过允许大小。', 413, 'payload_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function readJson(request, maxBytes = 1153434) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new ContentError('请求必须使用 JSON 格式。', 415, 'media_type');
  const bytes = await readBytes(request, maxBytes);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ContentError('JSON 数据无法解析。', 400, 'json'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContentError('JSON 数据必须是对象。', 400, 'json');
  return value;
}
export async function readFileUpload(request, maxBytes) {
  if (!/^multipart\/form-data;\s*boundary=/i.test(request.headers.get('content-type') || '')) throw new ContentError('请使用文件上传表单。', 415, 'media_type');
  const bytes = await readBytes(request, maxBytes + 65536);
  let form;
  try { form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type') } }).formData(); }
  catch { throw new ContentError('文件上传数据无效。'); }
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function' || !file.name || file.size > maxBytes || form.getAll('file').length !== 1) throw new ContentError('请选择有效且大小符合限制的文件。', 413, 'payload_too_large');
  return file;
}
