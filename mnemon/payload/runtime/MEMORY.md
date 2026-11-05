Mnemon 跨工具共享：DSH 的 dsh-mnemon 读 cordis.patch.yml 的 `dataDir: D:\memory`（store=default）；而 mnemon CLI/hooks 默认 data-dir 是 `C:\Users\13966\.mnemon`。已通过用户级环境变量 `MNEMON_DATA_DIR=D:\memory` 把 CodeBuddy/WorkBuddy 的 hooks 对齐到同一库，使 DSH+CB+WB 三者共享 `D:\memory\data\default\mnemon.db`。注意：mnemon 的 Stop hook 只输出"评估是否要记"的提示，不会自动写库；真正存储需模型执行 `mnemon remember`。
§
用户 2026-11-02 要求把 DeepSeek 网页版聊天记录导出（conversations.json 150 个会话）整理分类写入本地 Mnemon 记忆库；明确隐私不敏感、纯本地存储、全部如实记录。
§
本机所有模型必须放在 D 盘（用户原话：“模型必须运行在 D 盘，这是死规定”）：HF_HOME/HF_HUB_CACHE → D:\AIModels\huggingface，TORCH_HOME → D:\AIModels\torch；下载/缓存不得落 C 盘，模型启动脚本也应显式设置这些路径。
