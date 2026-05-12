/**
 * register.js — 智能检测 QQ 通道 + 生成课表提醒 cron 配置
 *
 * 用法:
 *   node register.js                          # 交互模式 (推荐)
 *   node register.js <投递目标>                # 直接指定
 *   node register.js c2c:<openid>              # QQ私聊
 *   node register.js group:<group_openid>      # QQ群
 *
 * 交互模式会自动检测本机 QQ Bot 配置和历史会话, 列出可选通道。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const SUMMER_START = { month: 5, day: 1 };
const SUMMER_END   = { month: 10, day: 7 };

// ── 参数解析 ──
const args = process.argv.slice(2);
let deliveryTo = null;

if (args.length > 0 && !args[0].startsWith('-')) {
  const raw = args[0];
  if (raw.includes(':')) {
    deliveryTo = raw.startsWith('qqbot:') ? raw : `qqbot:${raw}`;
  } else if (/^[a-f0-9]{20,}$/i.test(raw)) {
    deliveryTo = `qqbot:c2c:${raw}`;
  } else {
    deliveryTo = `qqbot:${raw}`;
  }
}
const coursesFile = args[1] || 'courses.json';

// ── 检查 courses.json ──
if (!fs.existsSync(coursesFile)) {
  console.error(`❌ 找不到 ${coursesFile}`);
  console.error('   请先运行: node parse.js <课表HTML> <首周周一>');
  process.exit(1);
}

const courses = JSON.parse(fs.readFileSync(coursesFile, 'utf8'));
if (courses.length === 0) {
  console.error('❌ courses.json 为空');
  process.exit(1);
}

const semesterStart = courses[0].dateFrom || '???';

// ── 检测本机 QQ Bot 配置 ──
function detectQQBot() {
  const configPaths = [
    path.join(os.homedir(), '.openclaw', 'openclaw.json'),
    path.join(os.homedir(), '.config', 'openclaw', 'openclaw.json'),
  ];

  for (const p of configPaths) {
    if (fs.existsSync(p)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
        const qq = cfg.channels?.qqbot;
        if (qq?.enabled) {
          return {
            enabled: true,
            appId: qq.appId,
            allowFrom: qq.allowFrom,
            configPath: p,
          };
        }
      } catch (e) { /* skip */ }
    }
  }
  return { enabled: false };
}

// ── 交互式选择 ──
async function interactiveMode() {
  const qqCfg = detectQQBot();

  console.log('🔍 检测本机 QQ Bot 配置...');
  if (qqCfg.enabled) {
    console.log(`   ✅ QQ Bot 已启用 (appId: ${qqCfg.appId})`);
  } else {
    console.log('   ⚠️  未检测到 QQ Bot 配置');
  }

  console.log('\n📡 可用投递方式:\n');

  if (qqCfg.enabled) {
    console.log('   你的 QQ Bot 已接入 OpenClaw。获取投递目标的方法:');
    console.log('   1. 在 QQ 上给机器人发一条消息');
    console.log('   2. 在 OpenClaw 中说「列出会话」查看 QQ 会话');
    console.log('   3. 复制会话列表中 QQ 私聊的 openid');
    console.log();
    console.log('   格式示例:');
    console.log('     qqbot:c2c:8f2dc47be3258b297f8d8d372e00b3d0     (私聊)');
    console.log('     qqbot:group:abc123def456                         (群聊)');
    console.log();
  } else {
    console.log('   请提供投递目标，格式:');
    console.log('     qqbot:c2c:<你的openid>      私聊');
    console.log('     qqbot:group:<群openid>      群聊');
    console.log();
  }

  // 手动输入
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const input = await new Promise(resolve => {
    rl.question('投递目标: ', answer => {
      rl.close();
      resolve(answer.trim());
    });
  });

  if (!input) {
    console.error('❌ 未输入投递目标');
    process.exit(1);
  }

  if (input.startsWith('qqbot:')) return input;
  if (/^[a-f0-9]{20,}$/i.test(input)) return `qqbot:c2c:${input}`;
  return `qqbot:${input}`;
}

// ── 生成配置 ──
async function main() {
  // 交互模式
  if (!deliveryTo) {
    deliveryTo = await interactiveMode();
  }

  console.log(`\n📅 学期首周周一: ${semesterStart}`);
  console.log(`📬 投递目标: ${deliveryTo}`);
  console.log(`☀️  夏令时: ${SUMMER_START.month}/${SUMMER_START.day}-${SUMMER_END.month}/${SUMMER_END.day}\n`);

  // 按 cronExpr 分组
  const groups = new Map();
  courses.forEach(c => {
    const key = c.cronExpr;
    if (!groups.has(key)) {
      groups.set(key, { cronExpr: c.cronExpr, weekday: c.weekday, courses: [] });
    }
    groups.get(key).courses.push(c);
  });

  const groupList = Array.from(groups.values());
  groupList.sort((a, b) => a.cronExpr.localeCompare(b.cronExpr));

  console.log(`📦 ${groupList.length} 个 cron 任务\n`);

  groupList.forEach((g, i) => {
    console.log(`${i + 1}. ${g.weekday} | cron: \`${g.cronExpr}\``);
    g.courses.forEach(c => {
      const hasSeason = c.isPM && c.startTimeWinter !== c.startTimeSummer;
      const timeStr = hasSeason
        ? `❄️${c.startTimeWinter} / ☀️${c.startTimeSummer}`
        : c.startTimeWinter;
      console.log(`   📚 ${c.courseName} | ${timeStr} | ${c.weeks}`);
    });
    console.log();
  });

  // 生成 prompt
  function buildPrompt(semesterStart, courses) {
    return `你是一个课表提醒助手。

学期首周周一 = ${semesterStart}
夏令时规则: ${SUMMER_START.month}月${SUMMER_START.day}日 - ${SUMMER_END.month}月${SUMMER_END.day}日, 下午课程(isPM=true)延后30分钟

你的任务:
1. 获取当前日期, 计算「今天是第几周」:
   weekNum = Math.floor((今天 - new Date("${semesterStart}")) / (7*86400000)) + 1

2. 判断冬令时/夏令时:
   - 月 > ${SUMMER_START.month} 且 < ${SUMMER_END.month} → 夏令时
   - 月 = ${SUMMER_START.month} 且 日 >= ${SUMMER_START.day} → 夏令时
   - 月 = ${SUMMER_END.month} 且 日 <= ${SUMMER_END.day} → 夏令时
   - 否则 → 冬令时

3. 遍历课程列表, 筛选 weekNumbers 包含当前周的课程:
${JSON.stringify(courses)}

4. 对每门有课的课程, 选择正确的时间:
   - isPM=true 且 夏令时 → 显示 startSummer-endSummer
   - 否则 → 显示 startWinter-endWinter

5. 如果今天有课 → 输出提醒消息
6. 如果今天没课 → 只回复 NO_REPLY

提醒格式:
📚 {课程名}
👤 {教师}  📍 {教室}
⏰ {选定时间}  📅 第{当前周}周

要求: 不要解释身份, 不要打招呼, 只输出提醒或NO_REPLY, 用emoji点缀`;
  }

  // 输出注册配置
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
      name: `课表提醒-${g.weekday}${g.courses[0].reminderWinter}`,
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
        to: deliveryTo,
      },
    };
  });

  fs.writeFileSync('register_configs.json', JSON.stringify(registerConfigs, null, 2));
  console.log(`✅ ${registerConfigs.length} 个 cron 配置 → register_configs.json`);
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
