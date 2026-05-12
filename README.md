# schedule-reminder

课表 HTML → 解析课程 → QQ 频道定时提醒（课前 30 分钟）

## 流程

```
HTML 课表源码 → 输入学期首周首日 → 解析课程 + 计算实际日期 → 生成 cron 任务 → QQ Bot 频道推送
```

## 使用方式

### 1. 解析课表

```bash
node parse.js <首周周一日期>
# 示例: node parse.js 2026-02-23
```

需要提供学期第一周的周一日期（YYYY-MM-DD），用于将「第X周」转换为实际日历日期。

输出 `courses.json`，每门课包含：

| 字段 | 说明 | 示例 |
|------|------|------|
| courseName | 课程名称 | 数字媒介技术原理与前沿 |
| teacher | 教师 | 王威力 |
| room | 教室 | 1-4061 |
| weekday | 星期 | 星期一 |
| startTime | 上课时间 | 08:00 |
| reminderTime | 提醒时间(课前30min) | 07:30 |
| cronExpr | cron 表达式 | 30 07 * * 1 |
| weeks | 原始周次 | 第1-8周 |
| weekNumbers | 解析后周次列表 | [1,2,3,4,5,6,7,8] |
| dateFrom | 课程首日 | 2026-02-23 |
| dateTo | 课程末日 | 2026-04-19 |

### 2. 注册提醒 (TODO)

```bash
node register.js
```

读取 `courses.json`，通过 OpenClaw cron 工具注册定时任务。

## 提醒规则

- 每节课开始前 **30 分钟** 发送提醒
- 提醒内容：课程名 + 时间 + 教室 + 当前周次
- 通过 QQ Bot 频道文字子频道推送
- cron 每周触发，提醒消息内标注该课是否本周上课

## 文件结构

```
260510schedule-reminder/
├── README.md          # 本文件
├── xskbcx.html        # 课表 HTML 源码（源文件）
├── schedule_raw.html  # 解码后的原始 HTML
├── schedule_data.js   # 提取的课程数据 JS
├── parse.js           # 解析脚本 → courses.json
├── courses.json       # 结构化课程数据
└── register.js        # cron 注册脚本 (TODO)
```

## 状态

- [x] 获取课表 HTML
- [x] 解析课程数据
- [x] 接入学期日期计算
- [ ] 确认/调整节次时间映射
- [ ] 确认目标 QQ 频道
- [ ] 注册 cron 提醒任务
- [ ] 测试提醒推送
