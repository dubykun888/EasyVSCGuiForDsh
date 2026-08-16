const http = require('http');
const { checkPort } = require('../out/dsh/PortDetector.js');
const { findLocalDshDefaultPort } = require('../out/dsh/LocalDshConfig.js');
const { DshProxy } = require('../out/proxy/DshProxy.js');

async function main() {
  // 1. dsh on 3080 should be recognized.
  const dshPort = await checkPort(3080, 2000);
  console.log('dsh port check:', dshPort);
  if (!dshPort.occupied || !dshPort.isDsh) {
    throw new Error('Expected 3080 to be a running dsh service');
  }

  // 2. Local dsh default port should resolve (to 3080 when unconfigured).
  const localPort = await findLocalDshDefaultPort('dsh');
  console.log('local dsh default port:', localPort);
  if (localPort !== 3080) {
    throw new Error(`Expected local dsh default port 3080, got ${localPort}`);
  }

  // 3. A non-dsh HTTP server on a random port should be recognized as occupied/non-dsh.
  const foreign = http.createServer((_req, res) => res.end('hello'));
  await new Promise((resolve) => foreign.listen(0, '127.0.0.1', resolve));
  const foreignPort = foreign.address().port;
  const foreignCheck = await checkPort(foreignPort, 2000);
  console.log('foreign port check:', foreignCheck);
  if (!foreignCheck.occupied || foreignCheck.isDsh) {
    throw new Error('Expected foreign server to be non-dsh');
  }
  await new Promise((resolve) => foreign.close(resolve));

  // 4. Proxy should rewrite dsh theme.
  const proxy = new DshProxy({ upstreamPort: 3080, theme: 'dark' });
  const proxyPort = await proxy.start();
  const html = await getText(`http://127.0.0.1:${proxyPort}/`);
  console.log('proxy rewrite dark:', /preference = "dark"/.test(html));
  if (!/preference = "dark"/.test(html)) {
    throw new Error('Proxy did not rewrite theme bootstrap');
  }

  // 5. API trust fence: pickDirectory through the proxy must not 403.
  const pickStatus = await postStatus(`http://127.0.0.1:${proxyPort}/api/host.pickDirectory`, {
    Origin: `http://127.0.0.1:${proxyPort}`,
    'Sec-Fetch-Site': 'same-origin',
  });
  console.log('pickDirectory proxy status:', pickStatus);
  if (pickStatus === 403) {
    throw new Error('Proxy still triggers HTTP 403 on /api/host.pickDirectory');
  }
  await proxy.stop();

  console.log('SMOKE OK');
}

function getText(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function postStatus(url, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      }
    );
    req.on('error', reject);
    req.end(JSON.stringify({}));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
