import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

export function endpoint(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    net.isIP(url.hostname) ||
    !url.hostname.includes('.') ||
    /\.(local|localhost|internal)$/i.test(url.hostname)
  )
    throw new Error('请填写公网 HTTPS API 地址');
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions';
  return url.href;
}
export function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && [18, 19].includes(b))
    );
  }
  // Accept only global-unicast IPv6, excluding mapped IPv4 and special-use ranges.
  return /^2[0-9a-f]{3}:/i.test(address) && !/^2001:(?:db8|0):/i.test(address);
}

export function safeAiFetch(address, { headers, body, signal }) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    let failBody,
      finished = false;
    const detachAbort = () => signal?.removeEventListener('abort', abort);
    const abort = () => {
      const error = signal.reason || new DOMException('The operation was aborted', 'AbortError');
      failBody?.(error);
      req.destroy(error instanceof Error ? error : new Error(String(error)));
      detachAbort();
      reject(error);
    };
    const req = https.request(
      endpoint(address),
      {
        method: 'POST',
        headers,
        signal,
        lookup(host, options, callback) {
          dns.lookup(host, { all: true }, (error, records) => {
            if (error) return callback(error);
            if (!records.length || records.some((r) => !publicAddress(r.address)))
              return callback(new Error('API 地址必须指向公网服务'));
            const family = typeof options === 'number' ? options : options.family;
            const selected = records.filter((r) => !family || r.family === family);
            if (!selected.length) return callback(new Error('API 地址无法连接'));
            if (options.all) callback(null, selected);
            else callback(null, selected[0].address, selected[0].family);
          });
        },
      },
      (res) => {
        let bytes = 0;
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          for (const part of Array.isArray(value) ? value : [value])
            if (part !== undefined) responseHeaders.append(name, part);
        }
        const stream = new ReadableStream(
          {
            start(controller) {
              failBody = (error) => {
                if (finished) return;
                finished = true;
                detachAbort();
                controller.error(error);
                const transportError = error instanceof Error ? error : new Error(String(error));
                res.destroy(transportError);
                req.destroy(transportError);
              };
              res.on('data', (chunk) => {
                if (finished) return;
                bytes += chunk.length;
                if (bytes > 4 * 1024 * 1024) {
                  failBody(new Error('AI 响应过大'));
                  return;
                }
                controller.enqueue(
                  new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
                );
                if (controller.desiredSize <= 0) res.pause();
              });
              res.on('end', () => {
                if (finished) return;
                finished = true;
                detachAbort();
                controller.close();
              });
              res.on('error', (error) => failBody(error));
              res.on('aborted', () =>
                failBody(signal?.aborted ? signal.reason : new Error('AI 响应中断')),
              );
              res.on('close', () => {
                if (!finished) failBody(new Error('AI 响应中断'));
              });
              // Keep the socket paused until the consumer requests data; never buffer the
              // complete answer before returning its headers and readable response body.
              res.pause();
            },
            pull() {
              if (!finished) res.resume();
            },
            cancel() {
              if (finished) return;
              finished = true;
              detachAbort();
              res.destroy();
              req.destroy();
            },
          },
          { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength },
        );
        try {
          const status = res.statusCode || 502;
          const empty = [204, 205, 304].includes(status);
          const response = new Response(empty ? null : stream, {
            status,
            headers: responseHeaders,
          });
          resolve(response);
          if (empty) void stream.cancel();
        } catch (error) {
          failBody(error);
          reject(error);
        }
      },
    );
    req.on('error', (error) => {
      failBody?.(error);
      detachAbort();
      reject(error);
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    else req.end(body);
  });
}
