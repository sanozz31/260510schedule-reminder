/**
 * register.js — 从 courses.json 生成课表提醒 cron 配置
 *
 * 用法: node register.js
 * 前提: 已运行 parse.js <首周周一> 生成 courses.json
 *
 * 夏令时规则: 5/1-10/7, 第5节起延后30分钟
 * Agent 运行时会根据当前日期自动选择正确时间
 */

const fs = require('fs');

const COURSES_FILE = './courses.json';
const QQ_OPENID = '8f2dc47be3258b297f8d8d372e00b3d0';
const DELIVERY_TO = `qqbot:c2c:${QQ_OPENID}`;

const SUMMER_START = { month: 5, day: 1 };
const SUMMER_END   = { month: 10, day: 7 };

if (!fs.existsSync(COURSES_FILE)) {
  console.error(`❌ 找不到 ${COURSES_FILE}，请先运行: node parse.js <首周周一>`);
  process.exit(1);
}
const courses = JSON.parse(fs.readFileSync(COURSES_FILE, 'utf8'));

const semesterStart = courses[0]?.dateFrom
  ? new Date(courses[0].dateFrom).toISOString().slice(0, 10)
  : '2026-03-02';

console.log(`📅 学期首周周一: ${semesterStart}`);
console.log(`☀️  夏令时: ${SUMMER_START.month}/${SUMMER_START.day}-${SUMMER_END.month}/${SUMMER_END.day} (第5节起+30min)\n`);

// ── 按 cronExpr 分组 ──
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

groupList.forEach((g, i) => {
  const courseData = g.courses.map(c => ({
    name: c.courseName,
    teacher: c.teacher,
    room: c.room,
    startWinter: c.startTimeWinter,
    endWinter: c.endTimeWinter,
    startSummer: c.startTimeSummer,
    endSummer: c.endTimeSummer,
    isPM: c.isPM,
    weeks: c.weekNumbers,
  }));

  const prompt = buildPrompt(semesterStart, courseData);

  console.log(`${i + 1}. ${g.weekday} ${g.reminderTime} → cron: \`${g.cronExpr}\``);
  g.courses.forEach(c => {
    if (c.isPM) {
      console.log(`   📚 ${c.courseName} | ❄️${c.startTimeWinter} ☀️${c.startTimeSummer} | ${c.weeks}`);
    } else {
      console.log(`   📚 ${c.courseName} | ${c.startTimeWinter} | ${c.weeks}`);
    }
  });
  console.log();
});

// ── 输出注册配置 ──
const registerConfigs = groupList.map(g => {
  const courseData = g.courses.map(c => ({
    name: c.courseName,
    teacher: c.teacher,
    room: c.room,
    startWinter: c.startTimeWinter,
    endWinter: c.endTimeWinter,
    startSummer: c.startTimeSummer,
    endSummer: c.endTimeSummer,
    isPM: c.isPM,
    weeks: c.weekNumbers,
  }));

  return {
    name: `课表提醒-${g.weekday}${g.reminderTime}`,
    schedule: { kind: 'cron', expr: g.cronExpr, tz: 'Asia/Shanghai' },
    sessionTarget: 'isolated',
    payload: {
      kind: 'agentTurn',
      message: buildPrompt(semesterStart, courseData),
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

// ── Prompt 模板 ──
function buildPrompt(semesterStart, courses) {
  const coursesJson = JSON.stringify(courses);

  return `你是一个课表提醒助手。

学期首周周一 = ${semesterStart}
夏令时规则: ${SUMMER_START.month}月${SUMMER_START.day}日 - ${SUMMER_END.month}月${SUMMER_END.day}日, 下午课程(isPM=true)延后30分钟

你的任务:
1. 获取当前日期，计算「今天是第几周」:
   weekNum = Math.floor((今天 - new Date("${semesterStart}")) / (7*86400000)) + 1

2. 判断今天是冬令时还是夏令时:
   - 月 > ${SUMMER_START.month} 且 < ${SUMMER_END.month} → 夏令时
   - 月 = ${SUMMER_START.month} 且 日 >= ${SUMMER_START.day} → 夏令时
   - 月 = ${SUMMER_END.month} 且 日 <= ${SUMMER_END.day} → 夏令时
   - 否则 → 冬令时

3. 遍历课程列表，筛选 weekNumbers 包含当前周的课程:
${coursesJson}

4. 对每门有课的课程，选择正确的时间:
   - isPM=true 且 夏令时 → 显示 startSummer-endSummer
   - 否则 → 显示 startWinter-endWinter

5. 如果今天有课 → 输出提醒消息
6. 如果今天没课 → 只回复 NO_REPLY

提醒格式:
📚 {课程名}
👤 {教师}  📍 {教室}
⏰ {选定时间}  📅 第{当前周}周{冬/夏令时标记}

要求: 不要解释身份, 不要打招呼, 只输出提醒或NO_REPLY, 用emoji点缀`;
}
