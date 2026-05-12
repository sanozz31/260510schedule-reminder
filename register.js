/**
 * register.js — 从 courses.json 注册课表提醒 cron 任务
 *
 * 用法: node register.js
 * 前提: 已运行 parse.js <首周周一> 生成 courses.json
 *
 * 设计:
 *   - 按 (星期, 提醒时间) 去重分组
 *   - 每组一个 cron 任务，每周触发
 *   - 任务内根据当前日期判断「今天第几周」，筛选有课的课程
 *   - 有课 → 推送提醒到 QQ 私聊
 *   - 无课 → 静默 (NO_REPLY)
 */

const fs = require('fs');

const COURSES_FILE = './courses.json';
const QQ_OPENID = '8f2dc47be3258b297f8d8d372e00b3d0';
const DELIVERY_TO = `qqbot:c2c:${QQ_OPENID}`;

// ── 读取课程数据 ──
if (!fs.existsSync(COURSES_FILE)) {
  console.error(`❌ 找不到 ${COURSES_FILE}，请先运行: node parse.js <首周周一>`);
  process.exit(1);
}
const courses = JSON.parse(fs.readFileSync(COURSES_FILE, 'utf8'));

// ── 读取学期起始日期 ──
const semesterStart = courses[0]?.dateFrom
  ? new Date(courses[0].dateFrom).toISOString().slice(0, 10)
  : '2026-03-02';
console.log(`📅 学期首周周一: ${semesterStart}`);

// ── 按 (cronExpr) 分组 ──
const groups = new Map();
courses.forEach(c => {
  const key = c.cronExpr;
  if (!groups.has(key)) {
    groups.set(key, {
      cronExpr: c.cronExpr,
      reminderTime: c.reminderTime,
      weekday: c.weekday,
      courses: [],
    });
  }
  groups.get(key).courses.push(c);
});

const groupList = Array.from(groups.values());
groupList.sort((a, b) => a.cronExpr.localeCompare(b.cronExpr));

console.log(`📦 ${groupList.length} 个时间段分组\n`);

// ── 生成每个分组的 prompt ──
groupList.forEach((g, i) => {
  const courseData = g.courses.map(c => ({
    name: c.courseName,
    teacher: c.teacher,
    room: c.room,
    startTime: c.startTime,
    endTime: c.endTime,
    weeks: c.weekNumbers,
  }));

  const prompt = buildPrompt(semesterStart, g.weekday, g.reminderTime, courseData);

  console.log(`${i + 1}. ${g.weekday} ${g.reminderTime} → cron: ${g.cronExpr}`);
  g.courses.forEach(c => console.log(`   📚 ${c.courseName} (${c.weeks} | 周次${JSON.stringify(c.weekNumbers)})`));

  // 输出 cron 注册参数
  const [min, hour, , , dow] = g.cronExpr.split(' ');
  const jobConfig = {
    name: `课表提醒-${g.weekday}${g.reminderTime}`,
    schedule: { kind: 'cron', expr: g.cronExpr, tz: 'Asia/Shanghai' },
    sessionTarget: 'isolated',
    payload: {
      kind: 'agentTurn',
      message: prompt,
      timeoutSeconds: 60,
    },
    delivery: {
      mode: 'announce',
      channel: 'qqbot',
      to: DELIVERY_TO,
    },
  };

  console.log();
});

// 输出注册配置 JSON
const registerConfigs = groupList.map(g => {
  const courseData = g.courses.map(c => ({
    name: c.courseName,
    teacher: c.teacher,
    room: c.room,
    startTime: c.startTime,
    endTime: c.endTime,
    weeks: c.weekNumbers,
  }));

  return {
    name: `课表提醒-${g.weekday}${g.reminderTime}`,
    schedule: { kind: 'cron', expr: g.cronExpr, tz: 'Asia/Shanghai' },
    sessionTarget: 'isolated',
    payload: {
      kind: 'agentTurn',
      message: buildPrompt(semesterStart, g.weekday, g.reminderTime, courseData),
      timeoutSeconds: 60,
    },
    delivery: {
      mode: 'announce',
      channel: 'qqbot',
      to: DELIVERY_TO,
    },
  };
});

fs.writeFileSync('register_configs.json', JSON.stringify(registerConfigs, null, 2));
console.log(`✅ ${registerConfigs.length} 个 cron 配置已写入 register_configs.json`);
console.log(`\n复制其中的 job 对象，依次调用 cron add 即可注册所有提醒。`);

// ── Prompt 模板 ──
function buildPrompt(semesterStart, weekday, reminderTime, courses) {
  const coursesJson = JSON.stringify(courses, null, 2);

  return `你是一个课表提醒助手。学期首周周一 = ${semesterStart}。

你的任务：
1. 获取当前日期，计算「今天是第几周」：
   weekNum = floor((今天 - ${semesterStart}) / 7天) + 1
2. 遍历以下课程列表，筛选出 weekNumbers 包含当前周的课程：
${coursesJson}
3. 如果今天有课 → 输出提醒消息（格式见下方）
4. 如果今天没课 → 只回复 NO_REPLY

提醒消息格式（有课时）：
📚 {课程名}
👤 {教师}  📍 {教室}
⏰ {开始时间}-{结束时间}  📅 第{当前周}周
（多门课用空行分隔）

要求：
- 不要解释你是谁，不要打招呼
- 只输出提醒消息或 NO_REPLY
- 用 emoji 点缀，控制在每条课 2-3 行`;
}
