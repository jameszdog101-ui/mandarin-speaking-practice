export function wavDuration(buffer) {
  const view = new DataView(buffer);
  const tag = (offset) => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
  if (buffer.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('音訊必須為有效的 PCM WAV');
  let rate = 0, bytes = 0;
  for (let offset = 12; offset + 8 <= buffer.byteLength;) {
    const size = view.getUint32(offset + 4, true);
    if (offset + 8 + size > buffer.byteLength) throw new Error('音檔不完整');
    if (tag(offset) === 'fmt ') {
      if (size < 16 || view.getUint16(offset + 8, true) !== 1) throw new Error('不支援的 WAV 格式');
      const channels = view.getUint16(offset + 10, true), sampleRate = view.getUint32(offset + 12, true);
      const alignment = view.getUint16(offset + 20, true), bits = view.getUint16(offset + 22, true);
      rate = view.getUint32(offset + 16, true);
      if (channels !== 1 || bits !== 16 || alignment !== 2 || sampleRate < 8000 || sampleRate > 48000 || rate !== sampleRate * alignment) throw new Error('音訊格式不正確');
    }
    if (tag(offset) === 'data') bytes += size;
    offset += 8 + size + (size % 2);
  }
  if (!rate || !bytes || bytes % 2) throw new Error('音訊資料為空白或格式不正確');
  return bytes / rate;
}

export async function audioResponse(req, bucket, meta) {
  const headers = { 'content-type': meta.mime_type, 'cache-control': 'private, no-store', 'accept-ranges': 'bytes' };
  const range = req.headers.get('range');
  const size = meta.byte_size;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
    const object = await bucket.get(meta.r2_key, { range: { offset: start, length: end - start + 1 } });
    if (!object) return new Response(null, { status: 404 });
    return new Response(object.body, { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) } });
  }
  const object = await bucket.get(meta.r2_key);
  return object ? new Response(object.body, { headers: { ...headers, 'content-length': String(size) } }) : new Response(null, { status: 404 });
}
