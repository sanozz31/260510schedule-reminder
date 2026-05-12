const fs = require('fs');

// ── Config ──────────────────────────────────────────────
// Parse CLI: node parse.js <首周周一日期>
//   semesterStart = first Monday of week 1, format YYYY-MM-DD
//   Example: node parse.js 2026-03-02
const args = process.argv.slice(2);
const semesterStart = args[0] || null;

if (!semesterStart) {
  console.error('❌ 缺少学期首周首日参数');
  console.error('用法: node parse.js <首周周一日期>');
  console.error('示例: node parse.js 2026-03-02');
  process.exit(1);
}

const startDate = new Date(semesterStart + 'T00:00:00+08:00');
if (isNaN(startDate.getTime())) {
  console.error('❌ 日期格式无效，请使用 YYYY-MM-DD');
  process.exit(1);
}
// ────────────────────────────────────────────────────────

const js = fs.readFileSync('schedule_data.js', 'utf8');

// ── 节次时间映射 (冬令时基准) ──
const periodTimes = {
  1:  { start: '08:00', end: '08:50', ampm: 'am' },
  2:  { start: '09:00', end: '09:50', ampm: 'am' },
  3:  { start: '10:10', end: '11:00', ampm: 'am' },
  4:  { start: '11:10', end: '12:00', ampm: 'am' },
  5:  { start: '14:00', end: '14:50', ampm: 'pm' },
  6:  { start: '15:00', end: '15:50', ampm: 'pm' },
  7:  { start: '16:10', end: '17:00', ampm: 'pm' },
  8:  { start: '17:10', end: '18:00', ampm: 'pm' },
  9:  { start: '19:10', end: '20:00', ampm: 'pm' },
  10: { start: '20:10', end: '21:00', ampm: 'pm' },
  11: { start: '21:10', end: '22:00', ampm: 'pm' },
};

// ── 夏令时规则: 5/1-10/7, 第5节起延后30分钟 ──
const SUMMER_START = { month: 5, day: 1 };
const SUMMER_END   = { month: 10, day: 7 };

function add30(time) {
  const [h, m] = time.split(':').map(Number);
  let total = h * 60 + m + 30;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

function subtract30(time) {
  const [h, m] = time.split(':').map(Number);
  let total = h * 60 + m - 30;
  if (total < 0) total += 24 * 60;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const weekdayMap = { 1: '星期一', 2: '星期二', 3: '星期三', 4: '星期四', 5: '星期五', 6: '星期六', 7: '星期日' };
const weekdayCron = { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '0' };

// ── Parse week string like "第1-8周" or "第1-2，4-8周" ──
function parseWeeks(weekStr) {
  const weeks = [];
  const parts = weekStr.replace(/第|周/g, '').split(/[，,]/);
  parts.forEach(p => {
    const range = p.trim().split('-').map(Number);
    if (range.length === 2) {
      for (let w = range[0]; w <= range[1]; w++) weeks.push(w);
    } else if (range.length === 1 && !isNaN(range[0])) {
      weeks.push(range[0]);
    }
  });
  return [...new Set(weeks)].sort((a, b) => a - b);
}

// ── Week number → date range ──
function weekToDates(weekNum) {
  const [y, m, d] = semesterStart.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const week0Mon = new Date(base);
  week0Mon.setUTCDate(week0Mon.getUTCDate() - 7);
  const mon = new Date(week0Mon);
  mon.setUTCDate(mon.getUTCDate() + weekNum * 7);
  const sun = new Date(mon);
  sun.setUTCDate(sun.getUTCDate() + 6);
  const fmt = dt => dt.toISOString().slice(0, 10);
  return { mon: fmt(mon), sun: fmt(sun) };
}

// ── Check if a date is in summer time range ──
function isSummerTime(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+08:00');
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (m > SUMMER_START.month && m < SUMMER_END.month) return true;
  if (m === SUMMER_START.month && day >= SUMMER_START.day) return true;
  if (m === SUMMER_END.month && day <= SUMMER_END.day) return true;
  return false;
}

// ── Extract all td assignments ──
const courses = [];
const lines = js.split('\n');
let currentTdId = null;

for (const line of lines) {
  const tdMatch = line.match(/getElementById\("(td_\d+_\d+)"\)/);
  if (tdMatch) { currentTdId = tdMatch[1]; continue; }

  if (currentTdId) {
    const htmlMatch = line.match(/td\.innerHTML\+="([^"]*)"/);
    if (htmlMatch) {
      const content = htmlMatch[1];
      if (content !== '<br><br>' && content.includes('课程：')) {
        const [, weekdayStr, periodStr] = currentTdId.split('_');
        const weekday = parseInt(weekdayStr);
        const period = parseInt(periodStr);

        const fields = {};
        content.split('<br>').forEach(part => {
          const idx = part.indexOf('：');
          if (idx > 0) {
            fields[part.substring(0, idx).trim()] = part.substring(idx + 1).trim();
          }
        });

        courses.push({
          tdId: currentTdId,
          weekday, weekdayName: weekdayMap[weekday], cronDay: weekdayCron[weekday],
          period,
          courseName: fields['课程'] || '',
          className: fields['班级'] || '',
          teacher: fields['教师'] || '',
          room: fields['教室'] || '',
          periods: fields['节次'] || '',
          weeks: fields['周次'] || '',
        });
      }
    }
  }
}

// ── Group by course ──
const courseMap = new Map();
courses.forEach(c => {
  const key = `${c.courseName}|${c.weekday}|${c.weeks}|${c.room}`;
  if (!courseMap.has(key)) {
    courseMap.set(key, { ...c, minPeriod: c.period, maxPeriod: c.period });
  } else {
    const existing = courseMap.get(key);
    existing.minPeriod = Math.min(existing.minPeriod, c.period);
    existing.maxPeriod = Math.max(existing.maxPeriod, c.period);
  }
});

const uniqueCourses = Array.from(courseMap.values());
uniqueCourses.sort((a, b) => a.weekday - b.weekday || a.minPeriod - b.minPeriod);

// ── Print ──
console.log(`📅 学期首周周一: ${semesterStart}`);
console.log(`☀️  夏令时: ${SUMMER_START.month}/${SUMMER_START.day} - ${SUMMER_END.month}/${SUMMER_END.day} (第5节起+30min)\n`);

uniqueCourses.forEach(c => {
  const winterTime = periodTimes[c.minPeriod];
  const winterStart = winterTime?.start || '??:??';
  const isPM = winterTime?.ampm === 'pm';

  const weekNums = parseWeeks(c.weeks);
  const firstWeek = weekToDates(weekNums[0]);
  const lastWeek = weekToDates(weekNums[weekNums.length - 1]);

  const summerStart = isPM ? add30(winterStart) : winterStart;
  const reminderWinter = subtract30(winterStart);
  const reminderSummer = subtract30(summerStart);

  // Check if any instance falls in summer time
  const summerWeeks = weekNums.filter(w => {
    const dates = weekToDates(w);
    // Get the specific day of week from mon + offset
    const [y, m, d] = dates.mon.split('-').map(Number);
    const mon = new Date(Date.UTC(y, m - 1, d));
    const classDay = new Date(mon);
    classDay.setUTCDate(mon.getUTCDate() + (c.weekday - 1));
    return isSummerTime(classDay.toISOString().slice(0, 10));
  });

  const hasSummer = summerWeeks.length > 0;
  const hasWinter = summerWeeks.length < weekNums.length;
  const timeChanges = isPM && (hasSummer && hasWinter || hasSummer && winterStart !== summerStart);

  console.log(`${c.weekdayName} ${winterStart} | ${c.courseName}`);
  console.log(`  教师: ${c.teacher} | 教室: ${c.room}`);
  console.log(`  周次: ${c.weeks}`);
  if (timeChanges && hasWinter && hasSummer) {
    console.log(`  ❄️  冬令: ${winterStart} | 提醒 ${reminderWinter}`);
    console.log(`  ☀️  夏令: ${summerStart} | 提醒 ${reminderSummer}`);
  } else if (hasSummer && winterStart !== summerStart) {
    console.log(`  ☀️  全程夏令: ${summerStart} | 提醒 ${reminderSummer}`);
  } else {
    console.log(`  上课: ${winterStart} | 提醒 ${reminderWinter}`);
  }
  console.log();
});

// ── Output JSON ──
const output = uniqueCourses.map(c => {
  const winterTime = periodTimes[c.minPeriod];
  const winterStart = winterTime?.start || '??:??';
  const winterEnd = periodTimes[c.maxPeriod]?.end || '??:??';
  const isPM = winterTime?.ampm === 'pm';

  const summerStart = isPM ? add30(winterStart) : winterStart;
  const summerEnd   = isPM ? add30(winterEnd) : winterEnd;
  const reminderWinter = subtract30(winterStart);
  const reminderSummer = subtract30(summerStart);

  const weekNums = parseWeeks(c.weeks);
  const firstWeek = weekToDates(weekNums[0]);
  const lastWeek = weekToDates(weekNums[weekNums.length - 1]);

  // Always use winter reminder time for cron (earliest)
  // reminderWinter = "HH:MM", cron = "MM HH * * DOW"
  const [cronH, cronM] = reminderWinter.split(':');

  return {
    courseName: c.courseName,
    teacher: c.teacher,
    room: c.room,
    weekday: c.weekdayName,
    isPM,
    startTimeWinter: winterStart,
    endTimeWinter: winterEnd,
    startTimeSummer: summerStart,
    endTimeSummer: summerEnd,
    reminderWinter,
    reminderSummer,
    reminderTime: reminderWinter,
    cronExpr: `${cronM} ${cronH} * * ${c.cronDay}`,
    weeks: c.weeks,
    weekNumbers: weekNums,
    dateFrom: firstWeek.mon,
    dateTo: lastWeek.sun,
  };
});

fs.writeFileSync('courses.json', JSON.stringify(output, null, 2));
console.log(`✅ ${output.length} 门课已保存到 courses.json`);
console.log(`📋 学期配置: semesterStart=${semesterStart}`);
console.log(`⏱️  夏令时: ${SUMMER_START.month}/${SUMMER_START.day}-${SUMMER_END.month}/${SUMMER_END.day} (下午第5节起延后30分钟)`);
