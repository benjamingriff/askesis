import { createServer } from 'node:net';

const server = createServer();
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  server.close(() => console.log(port));
});
