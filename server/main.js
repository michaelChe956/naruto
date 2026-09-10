'use strict';

const { start } = require('./index');

start({})
  .then(({ origin, stop }) => {
    console.log(`关卡数据服务已启动：${origin}`);
    const shutdown = () => {
      stop().then(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })
  .catch((error) => {
    console.error('服务启动失败：', error);
    process.exitCode = 1;
  });
