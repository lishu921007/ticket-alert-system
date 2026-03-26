const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

const app = express();
const PORT = process.env.PORT || 3210;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'tickets.json');
const REMINDER_LOG = path.join(DATA_DIR, 'reminders.log');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({ dest: UPLOAD_DIR });
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function safeText(value, fallback = '') {
  return value == null ? fallback : String(value).trim();
}

function normalizeEmail(value) {
  return safeText(value).toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function defaultNotificationSettings() {
  return {
    senderName: 'OTW 工单预警中心',
    senderEmail: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    recipientMappings: [],
    autoNotifyEnabled: true,
    escalationRules: [
      { type: 'warning', afterDays: 0, recipients: ['owner'], enabled: true, label: '前置预警首次提醒' },
      { type: 'overdue', afterDays: 0, recipients: ['owner'], enabled: true, label: '超期首次提醒' },
      { type: 'overdue', afterDays: 1, recipients: ['owner'], enabled: true, label: '超期1天再次提醒' },
      { type: 'overdue', afterDays: 3, recipients: ['owner', 'teamLead'], enabled: true, label: '超期3天升级提醒' },
      { type: 'overdue', afterDays: 7, recipients: ['owner', 'teamLead', 'admin'], enabled: true, label: '超期7天重点催办' },
    ],
  };
}

function defaultDirectory() {
  return {
    owners: [],
    teams: [],
  };
}

function ensureDbShape(db = {}) {
  return {
    tickets: Array.isArray(db.tickets) ? db.tickets : [],
    reminders: Array.isArray(db.reminders) ? db.reminders : [],
    notificationSettings: {
      ...defaultNotificationSettings(),
      ...(db.notificationSettings || {}),
      recipientMappings: Array.isArray(db.notificationSettings?.recipientMappings) ? db.notificationSettings.recipientMappings : [],
      escalationRules: Array.isArray(db.notificationSettings?.escalationRules) ? db.notificationSettings.escalationRules : defaultNotificationSettings().escalationRules,
    },
    directory: {
      ...defaultDirectory(),
      ...(db.directory || {}),
      owners: Array.isArray(db.directory?.owners) ? db.directory.owners : [],
      teams: Array.isArray(db.directory?.teams) ? db.directory.teams : [],
    },
    notifications: Array.isArray(db.notifications) ? db.notifications : [],
  };
}

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    const init = ensureDbShape({});
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  return ensureDbShape(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(ensureDbShape(db), null, 2));
}

function parseDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const asText = String(Math.trunc(value));
    if (/^\d{8}$/.test(asText)) {
      const y = Number(asText.slice(0, 4));
      const m = Number(asText.slice(4, 6));
      const d = Number(asText.slice(6, 8));
      return dayjs(new Date(y, m - 1, d));
    }
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return dayjs(new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, parsed.S || 0));
  }
  const text = String(value).trim();
  if (/^\d{8}$/.test(text)) {
    const y = Number(text.slice(0, 4));
    const m = Number(text.slice(4, 6));
    const d = Number(text.slice(6, 8));
    return dayjs(new Date(y, m - 1, d));
  }
  const candidates = [dayjs(text), dayjs(text.replace(/\./g, '-')), dayjs(text.replace(/\//g, '-'))];
  return candidates.find((d) => d.isValid()) || null;
}

function daysLeft(deadline) {
  if (!deadline) return null;
  return dayjs(deadline).endOf('day').diff(dayjs(), 'day', true);
}

function normalizeOwnerItem(item = {}) {
  return {
    id: safeText(item.id) || `owner-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: safeText(item.name || item.owner),
    email: normalizeEmail(item.email),
    team: safeText(item.team),
    role: safeText(item.role || '负责人'),
    enabled: item.enabled !== false,
  };
}

function normalizeTeamItem(item = {}) {
  return {
    id: safeText(item.id) || `team-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: safeText(item.name || item.team),
    leaderName: safeText(item.leaderName),
    leaderEmail: normalizeEmail(item.leaderEmail),
    adminEmail: normalizeEmail(item.adminEmail),
    enabled: item.enabled !== false,
  };
}

function normalizeRecipientMappings(list = []) {
  return list.map((item) => ({ owner: safeText(item.owner), email: normalizeEmail(item.email) })).filter((item) => item.owner && item.email);
}

function normalizeEscalationRules(list = []) {
  return (list.length ? list : defaultNotificationSettings().escalationRules).map((item, index) => ({
    id: safeText(item.id) || `rule-${index + 1}`,
    type: safeText(item.type || 'overdue'),
    afterDays: Number(item.afterDays || 0),
    recipients: Array.isArray(item.recipients) ? item.recipients : ['owner'],
    enabled: item.enabled !== false,
    label: safeText(item.label || `规则${index + 1}`),
  }));
}

function normalizeFollowUp(item = {}) {
  return {
    id: safeText(item.id) || `fu-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    content: safeText(item.content),
    followedBy: safeText(item.followedBy),
    isImportant: Boolean(item.isImportant),
    createdAt: item.createdAt || nowIso(),
  };
}

function normalizeCloseRecord(item = {}) {
  return {
    closed: Boolean(item.closed),
    closeResult: safeText(item.closeResult),
    closedBy: safeText(item.closedBy),
    closedAt: item.closedAt || null,
  };
}

function normalizeReviewRecord(item = {}) {
  return {
    reviewStatus: safeText(item.reviewStatus),
    reviewComment: safeText(item.reviewComment),
    reviewedBy: safeText(item.reviewedBy),
    reviewedAt: item.reviewedAt || null,
  };
}

function normalizeRow(row, index, importMeta = {}) {
  const sourceSystem = safeText(row.sourceSystem || row['来源系统'] || row['系统'] || row['数据来源']);
  const title = safeText(row.title || row['标题'] || row['主题'] || row['工单标题'] || row['主题名称']);
  const accountNo = safeText(row.accountNo || row['户号'] || row['客户编号']);
  const accountName = safeText(row.accountName || row['户名'] || row['客户名称']);
  const owner = safeText(row.owner || row['负责人'] || row['处理人'] || row['派发人'] || row['整改联络人']);
  const team = safeText(row.team || row['传递班组/所'] || row['班组'] || row['部门']);
  const ownerEmail = safeText(row.ownerEmail || row['负责人邮箱'] || row['邮箱']);
  const ownerPhone = safeText(row.ownerPhone || row['负责人手机号'] || row['手机号'] || row['手机']);
  const description = safeText(row.description || row['描述'] || row['内容'] || row['问题描述'] || row['存在问题']);
  const deadlineRaw = row.receiptDeadline || row['回单时限'] || row['截止时间'] || row['时限'];
  const createdRaw = row.createdAt || row['创建时间'] || row['提交时间'] || row['派发时间'];
  const currentTimeRaw = row.currentTime || row['当前时间'];
  const rectificationStatus = safeText(row.rectificationStatus || row['整改情况'] || row['是否整改']);
  const progress = safeText(row.progress || row['整改进度']);
  const passedOnce = safeText(row.passedOnce || row['是否一次性通过']);
  const issueNo = safeText(row.issueNo || row['整改工单编号']);
  const receiptDeadline = parseDate(deadlineRaw);
  const createdAt = parseDate(createdRaw) || dayjs();
  const currentTime = parseDate(currentTimeRaw);
  const baseTicketNo = safeText(row.ticketNo || row['工单号'] || row['ticket_no'] || row['单号'] || row['序号'] || `${accountNo || accountName || 'AUTO'}-${createdAt.format('YYYYMMDD')}`);
  const ticketNo = accountNo ? `${baseTicketNo}-${accountNo}` : baseTicketNo;
  const dedupeKey = [sourceSystem, title, accountNo, accountName, owner, team, receiptDeadline ? receiptDeadline.toISOString() : ''].join('|');

  return {
    id: `${ticketNo}-${Date.now()}-${index}`,
    dedupeKey,
    ticketNo,
    owner,
    team,
    ownerEmail,
    ownerPhone,
    title,
    description,
    sourceSystem,
    accountNo,
    accountName,
    currentTime: currentTime ? currentTime.toISOString() : null,
    rectificationStatus,
    progress,
    passedOnce,
    issueNo,
    receiptDeadline: receiptDeadline ? receiptDeadline.toISOString() : null,
    createdAt: createdAt.toISOString(),
    notifiedWarning: false,
    notifiedOverdue: false,
    importedAt: nowIso(),
    importFileName: importMeta.originalname || '',
    followUps: [],
    processingResult: '',
    completedAt: null,
    reviewStatus: '',
    reviewComment: '',
    reviewedBy: '',
    reviewedAt: null,
    closed: false,
    closeResult: '',
    closedBy: '',
    closedAt: null,
  };
}

function classifyTicket(ticket) {
  const remain = daysLeft(ticket.receiptDeadline);
  let status = 'normal';
  if (remain != null && remain < 0) status = 'overdue';
  else if (remain != null && remain < 2) status = 'warning';

  const overdueDays = remain != null && remain < 0 ? Math.ceil(Math.abs(remain)) : 0;
  return {
    ...ticket,
    remainingDays: remain == null ? null : Number(remain.toFixed(2)),
    overdueDays,
    status,
    overdue: status === 'overdue',
    warning: status === 'warning',
    archivedBucket: status === 'overdue' || status === 'warning' ? '逾期工单标记' : '正常工单',
    closed: Boolean(ticket.closed),
  };
}

function isVisibleTicket(ticket) {
  return Boolean(safeText(ticket.title));
}

function getOwnerDirectoryMap(db) {
  return new Map((db.directory?.owners || []).map((item) => [safeText(item.name), normalizeOwnerItem(item)]));
}

function getTeamDirectoryMap(db) {
  return new Map((db.directory?.teams || []).map((item) => [safeText(item.name), normalizeTeamItem(item)]));
}

function resolveRecipients(ticket, settings, db, recipientsSpec = ['owner']) {
  const recipients = new Set();
  const ownerMap = getOwnerDirectoryMap(db);
  const teamMap = getTeamDirectoryMap(db);
  const ownerRecord = ownerMap.get(safeText(ticket.owner));
  const teamRecord = teamMap.get(safeText(ticket.team));

  for (const spec of recipientsSpec) {
    if (spec === 'owner') {
      for (const item of settings.recipientMappings || []) {
        if (safeText(item.owner) === safeText(ticket.owner) && item.email) recipients.add(normalizeEmail(item.email));
      }
      if (ownerRecord?.email) recipients.add(normalizeEmail(ownerRecord.email));
      if (ticket.ownerEmail) recipients.add(normalizeEmail(ticket.ownerEmail));
    }
    if (spec === 'teamLead' && teamRecord?.leaderEmail) recipients.add(normalizeEmail(teamRecord.leaderEmail));
    if (spec === 'admin' && teamRecord?.adminEmail) recipients.add(normalizeEmail(teamRecord.adminEmail));
  }

  return [...recipients].filter(Boolean);
}

function formatMailDate(value) {
  if (!value) return '-';
  const d = dayjs(value);
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : String(value);
}

function buildNotificationMail(ticket, type, ruleLabel = '') {
  const isOverdue = type === 'overdue';
  const subject = isOverdue ? `【超期处理提醒】${ticket.title || ticket.ticketNo}` : `【前置预警提醒】${ticket.title || ticket.ticketNo}`;
  const text = [
    '您好：',
    '',
    `您负责的工单已触发${isOverdue ? '超期' : '前置预警'}条件，请尽快处理。`,
    ruleLabel ? `催办规则：${ruleLabel}` : '',
    '',
    `工单号：${ticket.ticketNo || '-'}`,
    `主题名称：${ticket.title || '-'}`,
    `户号：${ticket.accountNo || '-'}`,
    `户名：${ticket.accountName || '-'}`,
    `派发时间：${formatMailDate(ticket.createdAt)}`,
    `负责人：${ticket.owner || '-'}`,
    `传递班组/所：${ticket.team || '-'}`,
    `回单时限：${formatMailDate(ticket.receiptDeadline)}`,
    `剩余天数：${ticket.remainingDays ?? '-'}`,
    `整改情况：${ticket.rectificationStatus || '-'}`,
    `处理结果：${ticket.processingResult || '-'}`,
    '',
    isOverdue ? '提示：该工单已超期，请立即处理并尽快回单。' : '提示：该工单距离超期已不足 2 天，请提前处理并完成回单。',
    '',
    '—— OTW 工单预警中心',
  ].filter(Boolean).join('\n');
  return { subject, text };
}

async function sendEmail({ to, subject, text, senderName, senderEmail }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const fromEmail = normalizeEmail(senderEmail || process.env.SMTP_FROM || user);
  const fromName = safeText(senderName || 'OTW 工单预警中心');
  if (!host || !user || !pass || !to?.length) return { channel: 'email', delivered: false, reason: 'SMTP not configured or recipient missing' };
  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  const from = fromEmail ? `${fromName} <${fromEmail}>` : fromName;
  await transporter.sendMail({ from, to: to.join(','), subject, text });
  return { channel: 'email', delivered: true, to, from, subject };
}

async function sendSmsMock({ to, text }) {
  const enabled = process.env.SMS_ENABLED === 'true';
  if (!enabled || !to) return { channel: 'sms', delivered: false, reason: 'SMS disabled or recipient missing' };
  fs.appendFileSync(REMINDER_LOG, `[${nowIso()}] SMS => ${to}: ${text}\n`);
  return { channel: 'sms', delivered: true, mock: true };
}

function getNotificationHistoryForTicket(db, ticketId) {
  return (db.notifications || []).filter((item) => item.ticketId === ticketId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function shouldRunRule(ticket, rule) {
  if (!rule.enabled) return false;
  if (rule.type !== ticket.status) return false;
  if (ticket.status === 'warning') return rule.afterDays === 0;
  if (ticket.status === 'overdue') return ticket.overdueDays >= Number(rule.afterDays || 0);
  return false;
}

function alreadyNotifiedForRule(db, ticketId, ruleId) {
  return (db.notifications || []).some((item) => item.ticketId === ticketId && item.ruleId === ruleId);
}

async function executeNotification(db, ticket, type, rule, settings, force = false) {
  const recipients = resolveRecipients(ticket, settings, db, rule.recipients);
  if (!recipients.length) {
    const failRecord = {
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ticketId: ticket.id,
      ticketNo: ticket.ticketNo,
      type,
      ruleId: rule.id,
      ruleLabel: rule.label,
      recipients: [],
      createdAt: nowIso(),
      result: { delivered: false, reason: 'no recipients' },
    };
    db.notifications.push(failRecord);
    return failRecord;
  }
  const mail = buildNotificationMail(ticket, type, rule.label);
  const emailResult = await sendEmail({ to: recipients, subject: mail.subject, text: mail.text, senderName: settings.senderName, senderEmail: settings.senderEmail });
  const smsResult = await sendSmsMock({ to: ticket.ownerPhone, text: mail.text });
  const record = {
    id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    type,
    ruleId: rule.id,
    ruleLabel: rule.label,
    recipients,
    createdAt: nowIso(),
    result: { emailResult, smsResult, forced: force },
  };
  db.notifications.push(record);
  return record;
}

async function evaluateAndNotify(force = false) {
  const db = readDb();
  const settings = db.notificationSettings || defaultNotificationSettings();
  const reminders = [];
  if (!settings.autoNotifyEnabled && !force) return reminders;

  for (let i = 0; i < db.tickets.length; i++) {
    const current = classifyTicket(db.tickets[i]);
    db.tickets[i] = { ...db.tickets[i], ...current };
    if (!isVisibleTicket(current) || current.closed) continue;

    for (const rule of normalizeEscalationRules(settings.escalationRules || [])) {
      if (!shouldRunRule(current, rule)) continue;
      if (!force && alreadyNotifiedForRule(db, current.id, rule.id)) continue;
      const notifyRecord = await executeNotification(db, current, current.status, rule, settings, force);
      reminders.push({ ticketNo: current.ticketNo, ticketId: current.id, type: current.status, ruleLabel: rule.label, recipients: notifyRecord.recipients, result: notifyRecord.result });
      db.reminders.push({ id: `r-${Date.now()}-${i}-${rule.id}`, ticketId: current.id, type: current.status, ruleId: rule.id, createdAt: nowIso(), result: notifyRecord.result });
      if (current.status === 'overdue') db.tickets[i].notifiedOverdue = true;
      if (current.status === 'warning') db.tickets[i].notifiedWarning = true;
    }
  }

  writeDb(db);
  return reminders;
}

function getDashboardPayload() {
  const db = readDb();
  const allClassified = db.tickets.map(classifyTicket);
  const tickets = allClassified.filter(isVisibleTicket).sort((a, b) => {
    const aVal = a.remainingDays == null ? 999999 : a.remainingDays;
    const bVal = b.remainingDays == null ? 999999 : b.remainingDays;
    return aVal - bVal;
  });
  const summary = {
    total: tickets.length,
    overdue: tickets.filter((t) => t.status === 'overdue').length,
    warning: tickets.filter((t) => t.status === 'warning').length,
    normal: tickets.filter((t) => t.status === 'normal').length,
    hiddenEmptyTitle: allClassified.length - tickets.length,
    rawTotal: allClassified.length,
    openCount: tickets.filter((t) => !t.closed).length,
    closedCount: tickets.filter((t) => t.closed).length,
    reviewedCount: tickets.filter((t) => safeText(t.reviewStatus)).length,
  };
  return { summary, tickets };
}

function getTicketDetail(ticketId) {
  const db = readDb();
  const raw = db.tickets.find((item) => item.id === ticketId);
  if (!raw) return null;
  const ticket = classifyTicket(raw);
  return { ...ticket, notifications: getNotificationHistoryForTicket(db, ticketId) };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'ticket-alert-system', now: nowIso() });
});

app.get('/api/notification-settings', (_req, res) => {
  const db = readDb();
  res.json({ ok: true, settings: db.notificationSettings });
});

app.post('/api/notification-settings', (req, res) => {
  try {
    const db = readDb();
    db.notificationSettings = {
      ...defaultNotificationSettings(),
      ...db.notificationSettings,
      senderName: safeText(req.body.senderName, 'OTW 工单预警中心'),
      senderEmail: normalizeEmail(req.body.senderEmail || process.env.SMTP_FROM || process.env.SMTP_USER),
      autoNotifyEnabled: req.body.autoNotifyEnabled !== false,
      recipientMappings: normalizeRecipientMappings(req.body.recipientMappings || []),
      escalationRules: normalizeEscalationRules(req.body.escalationRules || db.notificationSettings.escalationRules || []),
    };
    writeDb(db);
    res.json({ ok: true, settings: db.notificationSettings });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/directory', (_req, res) => {
  const db = readDb();
  res.json({ ok: true, directory: db.directory });
});

app.post('/api/directory', (req, res) => {
  try {
    const db = readDb();
    db.directory = {
      owners: (req.body.owners || []).map(normalizeOwnerItem).filter((item) => item.name),
      teams: (req.body.teams || []).map(normalizeTeamItem).filter((item) => item.name),
    };
    writeDb(db);
    res.json({ ok: true, directory: db.directory });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/tickets', (_req, res) => {
  const { tickets } = getDashboardPayload();
  res.json({ ok: true, total: tickets.length, tickets });
});

app.get('/api/tickets/:id', (req, res) => {
  const ticket = getTicketDetail(req.params.id);
  if (!ticket) return res.status(404).json({ ok: false, error: 'ticket not found' });
  res.json({ ok: true, ticket });
});

app.post('/api/tickets/:id/follow-ups', (req, res) => {
  try {
    const db = readDb();
    const idx = db.tickets.findIndex((item) => item.id === req.params.id);
    if (idx < 0) return res.status(404).json({ ok: false, error: 'ticket not found' });
    const followUp = normalizeFollowUp(req.body);
    if (!followUp.content) return res.status(400).json({ ok: false, error: 'content required' });
    db.tickets[idx].followUps = Array.isArray(db.tickets[idx].followUps) ? db.tickets[idx].followUps : [];
    db.tickets[idx].followUps.unshift(followUp);
    writeDb(db);
    res.json({ ok: true, followUps: db.tickets[idx].followUps });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/tickets/:id/process', (req, res) => {
  try {
    const db = readDb();
    const idx = db.tickets.findIndex((item) => item.id === req.params.id);
    if (idx < 0) return res.status(404).json({ ok: false, error: 'ticket not found' });
    db.tickets[idx].processingResult = safeText(req.body.processingResult);
    db.tickets[idx].completedAt = req.body.completedAt || (safeText(req.body.processingResult) ? nowIso() : null);
    db.tickets[idx].rectificationStatus = safeText(req.body.rectificationStatus || db.tickets[idx].rectificationStatus);
    writeDb(db);
    res.json({ ok: true, ticket: classifyTicket(db.tickets[idx]) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/tickets/:id/review', (req, res) => {
  try {
    const db = readDb();
    const idx = db.tickets.findIndex((item) => item.id === req.params.id);
    if (idx < 0) return res.status(404).json({ ok: false, error: 'ticket not found' });
    const review = normalizeReviewRecord({ ...req.body, reviewedAt: nowIso() });
    db.tickets[idx] = { ...db.tickets[idx], ...review };
    writeDb(db);
    res.json({ ok: true, ticket: classifyTicket(db.tickets[idx]) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/tickets/:id/close', (req, res) => {
  try {
    const db = readDb();
    const idx = db.tickets.findIndex((item) => item.id === req.params.id);
    if (idx < 0) return res.status(404).json({ ok: false, error: 'ticket not found' });
    const closeRecord = normalizeCloseRecord({ ...req.body, closedAt: req.body.closed !== false ? nowIso() : null });
    db.tickets[idx] = { ...db.tickets[idx], ...closeRecord };
    writeDb(db);
    res.json({ ok: true, ticket: classifyTicket(db.tickets[idx]) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/dashboard', (_req, res) => {
  const { summary, tickets } = getDashboardPayload();
  const teamStats = Object.values(tickets.reduce((acc, t) => {
    const key = safeText(t.team, '未分组');
    acc[key] ||= { team: key, total: 0, overdue: 0, warning: 0, normal: 0 };
    acc[key].total += 1;
    acc[key][t.status] += 1;
    return acc;
  }, {})).sort((a, b) => b.total - a.total);
  const ownerStats = Object.values(tickets.reduce((acc, t) => {
    const key = safeText(t.owner, '未分配');
    acc[key] ||= { owner: key, total: 0, overdue: 0, warning: 0, normal: 0 };
    acc[key].total += 1;
    acc[key][t.status] += 1;
    return acc;
  }, {})).sort((a, b) => b.total - a.total);
  res.json({ ok: true, summary, tickets, analytics: { teamStats: teamStats.slice(0, 10), ownerStats: ownerStats.slice(0, 10) } });
});

app.get('/api/notifications', (_req, res) => {
  const db = readDb();
  const notifications = [...db.notifications].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 300);
  res.json({ ok: true, total: notifications.length, notifications });
});

app.post('/api/run-reminders', async (req, res) => {
  const reminders = await evaluateAndNotify(Boolean(req.body.force));
  res.json({ ok: true, reminders });
});

app.post('/api/import/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'missing file' });
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const workbook = ext === '.csv'
      ? (() => {
          const buf = fs.readFileSync(req.file.path);
          try { return XLSX.read(buf, { type: 'buffer', codepage: 65001 }); } catch { return XLSX.read(buf, { type: 'buffer', codepage: 936 }); }
        })()
      : XLSX.readFile(req.file.path);
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
    const normalized = rows.map((row, idx) => normalizeRow(row, idx, { originalname: req.file.originalname }));
    const issues = [];
    normalized.forEach((item, idx) => {
      if (!safeText(item.title)) issues.push({ row: idx + 2, field: 'title', message: '主题名称为空，导入后会被隐藏' });
      if (!safeText(item.owner)) issues.push({ row: idx + 2, field: 'owner', message: '负责人为空' });
      if (!item.receiptDeadline) issues.push({ row: idx + 2, field: 'receiptDeadline', message: '回单时限无法识别' });
    });
    res.json({ ok: true, fileName: req.file.originalname, totalRows: normalized.length, preview: normalized.slice(0, 10).map(classifyTicket), issues });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'missing file' });
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const workbook = ext === '.csv'
      ? (() => {
          const buf = fs.readFileSync(req.file.path);
          try { return XLSX.read(buf, { type: 'buffer', codepage: 65001 }); } catch { return XLSX.read(buf, { type: 'buffer', codepage: 936 }); }
        })()
      : XLSX.readFile(req.file.path);
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
    const db = readDb();
    const existingKeys = new Set(db.tickets.map((t) => t.dedupeKey).filter(Boolean));
    const normalized = rows.map((row, idx) => normalizeRow(row, idx, { originalname: req.file.originalname }));
    const uniqueRows = normalized.filter((item) => {
      if (!item.dedupeKey) return true;
      if (existingKeys.has(item.dedupeKey)) return false;
      existingKeys.add(item.dedupeKey);
      return true;
    });
    db.tickets.push(...uniqueRows);
    writeDb(db);
    const reminders = await evaluateAndNotify(false);
    const visibleRows = uniqueRows.filter(isVisibleTicket);
    res.json({ ok: true, fileName: req.file.originalname, imported: uniqueRows.length, visibleImported: visibleRows.length, hiddenEmptyTitle: uniqueRows.length - visibleRows.length, skippedDuplicates: normalized.length - uniqueRows.length, reminders, sample: visibleRows.slice(0, 3).map(classifyTicket) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/export/tickets.csv', (_req, res) => {
  const { tickets } = getDashboardPayload();
  const headers = ['工单号', '主题名称', '户号', '户名', '负责人', '班组/所', '邮箱', '手机号', '回单时限', '当前时间', '剩余天数', '状态', '归档标记', '整改情况', '处理结果', '完成时间', '复核状态', '关闭状态', '描述'];
  const rows = tickets.map((t) => [t.ticketNo, t.title, t.accountNo, t.accountName, t.owner, t.team, t.ownerEmail, t.ownerPhone, t.receiptDeadline, t.currentTime, t.remainingDays, t.status, t.archivedBucket, t.rectificationStatus, t.processingResult || '', t.completedAt || '', t.reviewStatus || '', t.closed ? '已关闭' : '未关闭', (t.description || '').replace(/\n/g, ' ')]);
  const content = [headers, ...rows].map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="tickets-export.csv"');
  res.send('\uFEFF' + content);
});

app.get('/api/open/tickets', (_req, res) => {
  const { summary, tickets } = getDashboardPayload();
  res.json({ ok: true, generatedAt: nowIso(), summary, total: tickets.length, tickets });
});

app.get('/api/openapi.json', (_req, res) => {
  res.json({
    openapi: '3.1.0',
    info: { title: 'Ticket Alert System API', version: '2.0.0', description: '工单预警系统对外开放接口，返回全部主题名称非空的工单数据。' },
    servers: [{ url: '/', description: 'Current server' }],
    paths: {
      '/api/open/tickets': {
        get: {
          summary: '获取全部可见工单数据',
          responses: { '200': { description: '成功返回工单数据' } }
        }
      }
    }
  });
});

app.get('/api/open/docs', (_req, res) => {
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send('# Ticket Alert System Open API 文档\n\n- GET /api/open/tickets\n- GET /api/openapi.json\n');
});

app.get('/api/docs', (_req, res) => {
  res.json({
    ok: true,
    endpoints: [
      { method: 'GET', path: '/api/dashboard', desc: '获取看板、趋势与排行分析' },
      { method: 'GET', path: '/api/tickets/:id', desc: '获取工单详情、通知记录、跟进内容' },
      { method: 'POST', path: '/api/tickets/:id/follow-ups', desc: '新增跟进记录' },
      { method: 'POST', path: '/api/tickets/:id/process', desc: '登记处理结果与完成时间' },
      { method: 'POST', path: '/api/tickets/:id/review', desc: '登记复核结果' },
      { method: 'POST', path: '/api/tickets/:id/close', desc: '关闭/重开工单' },
      { method: 'GET', path: '/api/notifications', desc: '通知记录中心' },
      { method: 'GET', path: '/api/directory', desc: '负责人/班组基础信息' },
      { method: 'POST', path: '/api/directory', desc: '保存负责人/班组基础信息' },
      { method: 'POST', path: '/api/import/preview', desc: '导入预校验' },
      { method: 'POST', path: '/api/run-reminders', desc: '手动执行提醒与升级催办' },
      { method: 'GET', path: '/api/open/tickets', desc: '外部拉取全部工单数据' },
    ],
  });
});

app.use((err, _req, res, _next) => {
  res.status(500).json({ ok: false, error: err.message });
});

setInterval(() => {
  evaluateAndNotify(false).catch((err) => console.error('scheduled reminder error:', err.message));
}, Number(process.env.REMINDER_INTERVAL_MS || 10 * 60 * 1000));

app.listen(PORT, HOST, () => {
  console.log(`ticket-alert-system listening on http://${HOST}:${PORT}`);
});
