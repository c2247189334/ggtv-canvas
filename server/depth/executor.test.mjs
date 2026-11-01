import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createExecutor, installShutdown } from './executor.mjs';
import { readFileSync } from 'node:fs';

test('执行器关闭整棵子进程树、拒绝退出后的新任务；输出失败不吞原文', async () => {
  const children=[],killed=[];
  const launch=(command,args,options)=>{
    const c=new EventEmitter();c.pid=children.length+1;c.stdout=new EventEmitter();c.stderr=new EventEmitter();
    children.push(c);assert.equal(options.windowsHide,true);assert.equal(options.env.PYTHONDONTWRITEBYTECODE,'1');return c;
  };
  const executor=createExecutor({launch,killTree:c=>killed.push(c.pid)});
  const result=executor.run('python',['-B']);children[0].stderr.emit('data',Buffer.from('NO_CUDA'));
  executor.stop();assert.deepEqual(killed,[1]);children[0].emit('close',1);
  await assert.rejects(result,/NO_CUDA/);await assert.rejects(executor.run('python',[]),/退出/);
});
test('退出、Ctrl+C、SIGTERM和关控制台都调用统一清理，且只清理一次', () => {
  for(const event of ['exit','SIGINT','SIGTERM','SIGHUP']) {
    const events=new EventEmitter();let stops=0,exits=0;events.exit=()=>{exits++;events.emit('exit');};
    installShutdown(()=>{stops++;},events);events.emit(event);events.emit('exit');
    assert.equal(stops,1);assert.equal(exits,event==='exit'?0:1);
  }
});

test('Windows停止入口只结束确认后的PID和整个子进程树',()=>{
  const script=readFileSync(new URL('../../停止.bat',import.meta.url)).toString('latin1');
  assert.match(script,/taskkill \/PID %FOUND% \/T \/F/);
  assert.ok(script.indexOf('findstr /i /c:"start.mjs"')<script.indexOf('taskkill'));
});
test('停止信号只结束这一单的进程树，结果标已停止；已停止的信号不再启动进程', async () => {
  const children=[],killed=[];
  const launch=()=>{const c=new EventEmitter();c.pid=children.length+1;c.stdout=new EventEmitter();c.stderr=new EventEmitter();children.push(c);return c;};
  const executor=createExecutor({launch,killTree:c=>killed.push(c.pid)});
  const controller=new AbortController(),other=executor.run('ffmpeg',[]),mine=executor.run('python',[],{signal:controller.signal});
  controller.abort();assert.deepEqual(killed,[2]);children[1].emit('close',1);
  await assert.rejects(mine,error=>error.canceled===true);
  await assert.rejects(executor.run('python',[],{signal:controller.signal}),error=>error.canceled===true);
  assert.equal(children.length,2);children[0].emit('close',0);await other;
});
