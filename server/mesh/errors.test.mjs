import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meshError } from './errors.mjs';

test('白模各种失败固定两句人话，技术原文、磁盘路径和重复原因不上卡', () => {
  for (const [raw, expected] of [
    ['ComfyUI 执行失败：[[execution_error, C:\\private\\model, traceback]]', '节点、模型和运行状态'],
    ['ComfyUI 请求失败（500）：{"detail":"private diagnostic"}', '运行状态'],
    ['ComfyUI 返回内容不是 JSON：private diagnostic', '运行状态'],
    ['ComfyUI 启动失败：private diagnostic', '便携版能否正常打开'],
    ['ComfyUI 启动超时：private diagnostic', '手动打开'],
    ['白模缺少模型：private/model.safetensors', '模型安装'],
    ['这个地址上的 ComfyUI 没有白模节点，请检查端口。', '端口'],
    ['输出视频的尺寸不对，没有存进作品库。', '尺寸不对'],
    ['输出视频的帧率或时长不对，没有存进作品库。', '帧率或时长不对'],
    ['ComfyUI 已完成，但没有找到白模视频输出。', '输出节点'],
    ['CUDA out of memory: private diagnostic', '显存不够'],
    ['random failure: C:\\private\\secret', '详情见小服务日志']
  ]) {
    const message = meshError(Error(raw));
    assert.match(message, /^本地处理失败，没有自动重跑，花费 0。\n[^\n]+。$/);
    assert.ok(message.includes(expected), message);
    assert.doesNotMatch(message, /private|diagnostic|traceback|execution_error|safetensors/);
    assert.equal(message.split('。').filter(Boolean).length, 2);
  }
});

test('两种无法确认终态的用户动作都保留，附带技术原文丢到日志而非卡上', () => {
  for (const state of ['是否接单', '已停止']) {
    const message = meshError(Object.assign(Error(`fetch failed\n无法确认 ComfyUI ${state}，本机显卡队列已暂停；确认停止后请重启小服务。`), { gpuUnsafe: true }));
    assert.ok(message.includes(`无法确认 ComfyUI ${state}`));
    assert.match(message, /队列已暂停.*确认停止.*重启小服务。$/);
    assert.doesNotMatch(message, /fetch failed/);
  }
});
