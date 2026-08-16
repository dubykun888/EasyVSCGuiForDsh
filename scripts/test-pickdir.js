const http = require('http');
const { DshProxy } = require('../out/proxy/DshProxy.js');

async function main() {
  const proxy = new DshProxy({ upstreamPort: 3080, theme: 'dark' });
  const port = await proxy.start();
  const options = {
    host: '127.0.0.1',
    port,
    path: '/api/host.pickDirectory',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: `http://127.0.0.1:${port}`,
      'Sec-Fetch-Site': 'same-origin',
    },
  };
  const req = http.request(options, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', async () => {
      console.log('status:', res.statusCode);
      console.log('body:', body.slice(0, 200));
      await proxy.stop();
      if (res.statusCode === 403) {
        process.exit(1);
      }
      process.exit(0);
    });
  });
  req.on('error', async (err) => {
    console.error(err);
    await proxy.stop();
    process.exit(1);
  });
  req.end(JSON.stringify({}));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
