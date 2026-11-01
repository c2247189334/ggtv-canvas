// 读方舟 Chat 流式回包（SSE）。开深度思考时一轮要好几分钟，非流式连接上一直没数据，
// 官方深度思考文档说「极易因超时导致任务失败」（10-25 真测：2.1 Pro 拆解第一轮等满 300 秒被掐断）。

/** 读一块；空闲上限内一个字节都没来就关掉连接报错。 */
async function readWithin(reader, idleMs) {
  let timer;
  const idle = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(`豆包连续 ${Math.round(idleMs / 1000)} 秒没有回传任何内容，连接可能断了，已停止等待。`)), idleMs);
  });
  try { return await Promise.race([reader.read(), idle]); }
  finally { clearTimeout(timer); }
}

/**
 * 拼出第 0 个候选的 delta.content；思考内容（reasoning_content）不要，只当「还在干活」的信号。
 * usage 取最后一个非空值（请求带 stream_options.include_usage，[DONE] 前单独一块）。
 * 返回 { content, usage, finish, error }，结束是否正常由调用方按 finish 判断（[DONE] 只是传输结束）。
 */
export async function readChatStream(response, { idleMs }) {
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', content = '', usage = null, finish = null, error = null;
  const handle = line => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let event;
    try { event = JSON.parse(data); } catch { throw Error(`豆包流式回包有一块不是合法JSON：${data}`); }
    if (event?.error) error = event.error;
    if (event?.usage) usage = event.usage;
    for (const choice of Array.isArray(event?.choices) ? event.choices : []) {
      if ((choice?.index ?? 0) !== 0) continue;
      if (typeof choice.delta?.content === 'string') content += choice.delta.content;
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  };
  try {
    for (;;) {
      const { value, done } = await readWithin(reader, idleMs);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) { handle(buffer.slice(0, end).replace(/\r$/, '')); buffer = buffer.slice(end + 1); }
    }
    handle((buffer + decoder.decode()).trim());
  } catch (err) {
    reader.cancel().catch(() => {});
    throw err;
  }
  return { content, usage, finish, error };
}
