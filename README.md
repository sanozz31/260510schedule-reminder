# schedule-reminder

课表 HTML → 解析课程 → QQ 频道定时提醒（课前 30 分钟）

## 流程

```
HTML 课表源码 → 输入学期首周首日 → 解析课程 + 计算实际日期 → 生成 cron 任务 → QQ Bot 频道推送
```

## 使用方式

### 第一步: 解析课表

```bash
node parse.js <课表HTML文件> <首周周一日期>
# 示例: node parse.js xskbcx.html 2026-03-02
```

**输入**: 从教务系统保存的课表页面 HTML 源码（支持 xjtu GMIS 格式）
**输出**: `courses.json` — 结构化课程数据

### 第二步: 生成提醒配置

```bash
node register.js <你的QQ私聊openid>
# 示例: node register.js 8f2dc47be3258b297f8d8d372e00b3d0
```

**输出**: `register_configs.json` — 可直接用于 cron add 的注册参数

### 第三步: 注册 cron 任务

将 `register_configs.json` 中的每个 job 对象依次调用 `cron add`。

## 提醒规则

- 每节课开始前 **30 分钟** 发送提醒
- 提醒内容：课程名 + 时间 + 教室 + 当前周次
- 通过 QQ Bot 频道文字子频道推送
- cron 每周触发，提醒消息内标注该课是否本周上课

## 文件结构

```
260510schedule-reminder/
├── README.md              # 本文件
├── xskbcx.html            # 课表 HTML 源码（示例）
├── parse.js               # 一键解析 → courses.json
├── courses.json           # 结构化课程数据 (gitignored)
├── register.js            # 生成 cron 配置 → register_configs.json
└── register_configs.json  # cron 注册参数 (gitignored)
```

## 状态

- [x] 一键解析 HTML（无需中间文件）
- [x] 冬/夏令时自动识别
- [x] 通用参数化（HTML路径、学期日期、QQ openid）
- [ ] 自动注册 cron（第三步需通过 OpenClaw 工具完成）
