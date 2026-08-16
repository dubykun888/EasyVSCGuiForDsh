const { DshProxy } = require('../out/proxy/DshProxy.js');
const http = require('http');

(async () => {
  const proxy = new DshProxy({ upstreamPort: 3080, theme: 'dark' });
  const port = await proxy.start();
  console.log('proxy port', port);
  http.get(`http://127.0.0.1:${port}/`, (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', async () => {
      console.log('status', res.statusCode);
      console.log('has dark theme script', /preference = "dark"/.test(data));
      console.log('has x-frame-options header', res.headers['x-frame-options']);
      await proxy.stop();
      process.exit(0);
    });
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
