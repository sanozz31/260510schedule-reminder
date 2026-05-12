const fs = require('fs');

// ── Config ──────────────────────────────────────────────
// Parse CLI: node parse.js [semesterStart]
//   semesterStart = first Monday of week 1, format YYYY-MM-DD
//   Example: node parse.js 2026-02-23
const args = process.argv.slice(2);
const semesterStart = args[0] || null;

if (!semesterStart) {
  console.error('❌ 缺少学期首周首日参数');
  console.error('用法: node parse.js <首周周一日期>');
  console.error('示例: node parse.js 2026-02-23');
  process.exit(1);
}

const startDate = new Date(semesterStart + 'T00:00:00+08:00');
if (isNaN(startDate.getTime())) {
  console.error('❌ 日期格式无效，请使用 YYYY-MM-DD');
  process.exit(1);
}
// ────────────────────────────────────────────────────────

const js = fs.readFileSync('schedule_data.js', 'utf8');

// Time mapping for periods (XJTU graduate schedule)
const periodTimes = {
  1: { start: '08:00', end: '08:50' },
  2: { start: '09:00', end: '09:50' },
  3: { start: '10:10', end: '11:00' },
  4: { start: '11:10', end: '12:00' },
  5: { start: '14:00', end: '14:50' },
  6: { start: '15:00', end: '15:50' },
  7: { start: '16:10', end: '17:00' },
  8: { start: '17:10', end: '18:00' },
  9: { start: '19:00', end: '19:50' },
  10: { start: '20:00', end: '20:50' },
  11: { start: '21:00', end: '21:50' },
};

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
  // Use UTC to avoid timezone shifts on date math
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

function subtract30Min(time) {
  const [h, m] = time.split(':').map(Number);
  let total = h * 60 + m - 30;
  if (total < 0) total += 24 * 60;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// ── Print ──
console.log(`📅 学期首周周一: ${semesterStart}\n`);

uniqueCourses.forEach(c => {
  const startTime = periodTimes[c.minPeriod]?.start || '??:??';
  const reminderTime = subtract30Min(startTime);
  const weekNums = parseWeeks(c.weeks);
  const firstWeek = weekToDates(weekNums[0]);
  const lastWeek = weekToDates(weekNums[weekNums.length - 1]);

  console.log(`${c.weekdayName} ${startTime} | ${c.courseName}`);
  console.log(`  教师: ${c.teacher} | 教室: ${c.room}`);
  console.log(`  周次: ${c.weeks} (第${weekNums[0]}-${weekNums[weekNums.length-1]}周)`);
  console.log(`  日期: ${firstWeek.mon} → ${lastWeek.sun}`);
  console.log(`  提醒: ${reminderTime} | cron: ${reminderTime.split(':')[1]} ${reminderTime.split(':')[0]} * * ${c.cronDay}`);
  console.log();
});

// ── Output JSON ──
const output = uniqueCourses.map(c => {
  const startTime = periodTimes[c.minPeriod]?.start || '??:??';
  const reminderTime = subtract30Min(startTime);
  const [rmHour, rmMin] = reminderTime.split(':');
  const weekNums = parseWeeks(c.weeks);
  const firstWeek = weekToDates(weekNums[0]);
  const lastWeek = weekToDates(weekNums[weekNums.length - 1]);

  return {
    courseName: c.courseName,
    teacher: c.teacher,
    room: c.room,
    weekday: c.weekdayName,
    startTime,
    endTime: periodTimes[c.maxPeriod]?.end || '??:??',
    reminderTime,
    cronExpr: `${rmMin} ${rmHour} * * ${c.cronDay}`,
    weeks: c.weeks,
    weekNumbers: weekNums,
    dateFrom: firstWeek.mon,
    dateTo: lastWeek.sun,
  };
});

fs.writeFileSync('courses.json', JSON.stringify(output, null, 2));
console.log(`✅ ${output.length} 门课已保存到 courses.json`);
console.log(`📋 学期配置: semesterStart=${semesterStart}`);
