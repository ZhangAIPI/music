# IYGE 中国音乐教学馆藏 Demo

一个仿 Kodály Collection 信息架构的中文音乐教学资源库 demo：曲目检索、开放素材试听/预览、基于受众信息的一课时 AI 教案生成。

## GitHub Pages

本仓库可以直接用 GitHub Pages 从 `main` 分支根目录发布。Pages 是静态托管，不保存 API key；如果没有连接 `/api` 后端，页面会自动生成前端演示教案。

要连接远端 Node 后端代理，可以用查询参数指定 API origin：

```text
https://zhangaipi.github.io/music/?api=https://your-backend.example.com
```

当前演示页默认连接一个 tmux 中运行的 Cloudflare quick tunnel。quick tunnel 是临时地址，如果 tunnel 重启后地址变化，用上面的 `?api=` 参数覆盖，或更新 `app.js` 中的默认地址。

## 本地 / 服务器运行

```bash
cd /home/t-zelizhang/music
npm start
```

后端会优先读取本项目 `.env`，如果没有，会在本机开发环境中尝试读取 `../secrets_list.txt`。不要把真实密钥提交到 git。

## AI 配置

可复制 `.env.example` 为 `.env` 后填写：

```bash
OPENAI_API_KEY=...
OPENAI_BASE_URL=...
X_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
PORT=5177
```

当前网关使用 `X_API_KEY` 时，后端会通过 `X-API-Key` 请求头调用模型，避免把 key 暴露到浏览器。

## 素材

demo 素材来自 Wikimedia Commons，页面底部和曲目卡片中都保留了来源链接。实际产品建议替换为明确授权的校本曲库或自有录音。
