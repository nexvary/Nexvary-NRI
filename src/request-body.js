export async function readBoundedBody(request, limit) {
  if (Number(request.headers['content-length']) > limit) {
    request.resume();
    return;
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limit) {
      request.resume();
      return;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
