/**
 * Lark Cash Advance (Non-Travel) SLA Watchdog - Cloudflare Edge Worker
 * --------------------------------------------------------------------
 * 24/7 Serverless Watchdog running on Cloudflare Workers Free Tier.
 * - Zero bandwidth egress fees (100,000 requests/day free).
 * - Real-time Lark AnyCross approval webhook synchronization (<20ms response via ctx.waitUntil).
 * - Auto-healing safety-net cron reconciler (* * * * *) for missing Table 2 rows and stage updates.
 * - Auto-heals Vendor Bill No. and Check No. back to Table 1 when entered by Finance/Treasury.
 * - Enforces strict 2-Table Architecture (Table 1: tblIbyc67hpYTyiI, Table 2: tbliGywXHe6qMIm6).
 * - Zero external npm dependencies (native Web APIs only: fetch, Response, Request, URL).
 * - Hard subrequest budget guard (<= 42 subrequests) strictly within Cloudflare Free Tier limits (50 max).
 */

// -------------------------------------------------------------
// CANONICAL CONSTANTS & WORKFLOW MAPPINGS
// -------------------------------------------------------------

export const MAX_SUBREQUESTS = 42;

export const VENDOR_BILL_WIDGET_ID = 'widget17501233698840001';
export const CHECK_NO_WIDGET_ID = 'widget17501234330640001';

/**
 * The 8 canonical stage prefixes in Table 2 (Step Approval Log: tbliGywXHe6qMIm6).
 * Note: Stage 3 preserves the exact existing Table 2 column prefix 'Acounting Processing <2000'
 * (single 'c', no space before '<2000') to prevent 1254040 FieldNameNotFound errors.
 */
export const ALL_8_STAGES = [
  'Team Head (if none, enter requester name)',
  'Department Head',
  'Acounting Processing <2000',
  'Accounting Processing > 2000',
  'Treasury Processing > 2000',
  'For Check Releasing > 2000',
  'Approval',
  'Receipt',
];

/**
 * Verified 32-char MD5 node_id mappings from Approval Definition D375F005-FCC9-4AA7-8B03-683AA17F4997
 * ("Cash Advance Form (Non-Travel)", Admin ID 7690379670504460009).
 */
export const NODE_ID_TO_STAGE = {
  'c1e48274b814fdce8dc77ddc6be0cd82': 'Team Head (if none, enter requester name)',
  '2bc64761cd7fa34d3905a13b982c73f2': 'Department Head',
  'b42dc2a7ceae426ff6a9f683db746ac2': 'Acounting Processing <2000',
  '0d47568655d7427088adc32db11e6dea': 'Accounting Processing > 2000',
  'cc9562b8bb3b689f4051b9f64610f557': 'Treasury Processing > 2000',
  '42fbf264c757382bea8706424f06dd8e': 'For Check Releasing > 2000',
  '6303e52fcf398a2d8df73b79b144a6d4': 'Approval',
  '1750beb4c4c8c6afe329c07dd4ea6028': 'Receipt',
};

export const TERMINAL_OVERALL_STATUSES = new Set([
  'COMPLETED: Cash Advance Released',
  'Rejected',
  'Recalled',
  'Canceled',
]);

// -------------------------------------------------------------
// IN-MEMORY CACHE & SERVICE METRICS
// -------------------------------------------------------------

let tokenCache = {
  token: null,
  expiresAt: 0,
};

const exhaustedFinanceHealCache = new Set();

export function resetTokenCache() {
  tokenCache.token = null;
  tokenCache.expiresAt = 0;
  exhaustedFinanceHealCache.clear();
}

export const serviceMetrics = {
  webhooksReceived: 0,
  instancesCreated: 0,
  instancesUpdated: 0,
  table1Healed: 0,
  cronsExecuted: 0,
  lastCronTime: null,
};

// -------------------------------------------------------------
// FIELD NORMALIZATION, TOKEN & FORMATTING HELPERS
// -------------------------------------------------------------

export function extractText(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) {
    return val.map((item) => extractText(item)).join('').trim();
  }
  if (typeof val === 'object') {
    if (typeof val.text === 'string') return val.text.trim();
    if (typeof val.name === 'string') return val.name.trim();
    if (val.value !== undefined) return extractText(val.value);
  }
  return '';
}

export function extractUrlField(val) {
  if (!val) return { text: '', link: '' };
  if (Array.isArray(val)) {
    const first = val.find((item) => item && typeof item === 'object') || val[0];
    return extractUrlField(first);
  }
  if (typeof val === 'object') {
    const text = typeof val.text === 'string' ? val.text.trim() : extractText(val.text);
    const link = typeof val.link === 'string' ? val.link.trim() : '';
    return { text, link };
  }
  return { text: String(val).trim(), link: '' };
}

export function normalizeUserField(val, fallbackOpenId = '') {
  if (Array.isArray(val)) {
    const users = val
      .map((u) => {
        if (typeof u === 'string' && u.trim()) return { id: u.trim() };
        if (u && typeof u === 'object' && typeof u.id === 'string' && u.id.trim()) {
          return { id: u.id.trim() };
        }
        return null;
      })
      .filter(Boolean);
    if (users.length > 0) return users;
  } else if (val && typeof val === 'object' && typeof val.id === 'string' && val.id.trim()) {
    return [{ id: val.id.trim() }];
  } else if (typeof val === 'string' && val.trim()) {
    return [{ id: val.trim() }];
  }
  if (fallbackOpenId && typeof fallbackOpenId === 'string' && fallbackOpenId.trim()) {
    return [{ id: fallbackOpenId.trim() }];
  }
  return [];
}

export async function getTenantAccessToken(env, budget = null) {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expiresAt - 120000) {
    return tokenCache.token;
  }

  const appId = env && env.LARK_APP_ID;
  const appSecret = env && env.LARK_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error('Missing LARK_APP_ID or LARK_APP_SECRET in environment');
  }

  if (budget) budget.used++;
  const res = await fetch('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });

  if (!res.ok) {
    throw new Error(`Lark auth HTTP error: ${res.status}`);
  }

  const data = await res.json();
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Failed to get tenant_access_token: ${data.msg} (${data.code})`);
  }

  tokenCache.token = data.tenant_access_token;
  tokenCache.expiresAt = now + (data.expire ? data.expire * 1000 : 7200000);
  return tokenCache.token;
}

export function decodeInstanceCode(sourceId) {
  const raw = extractText(sourceId);
  if (!raw) return null;
  try {
    const decoded = atob(raw);
    if (decoded.includes(':')) {
      const parts = decoded.split(':');
      const code = parts[1] ? parts[1].trim() : '';
      return code || raw;
    }
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(decoded.trim())) {
      return decoded.trim();
    }
    return raw;
  } catch (_) {
    return raw;
  }
}

export function formatTimestamp(ms) {
  if (!ms || String(ms) === '0') return '';
  try {
    const val = parseInt(ms, 10);
    if (isNaN(val) || val <= 0) return '';
    // UTC+8 Manila Time
    const dt = new Date(val + 8 * 3600 * 1000);
    const year = dt.getUTCFullYear();
    const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dt.getUTCDate()).padStart(2, '0');
    const hours = String(dt.getUTCHours()).padStart(2, '0');
    const mins = String(dt.getUTCMinutes()).padStart(2, '0');
    const secs = String(dt.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${mins}:${secs}`;
  } catch (_) {
    return String(ms);
  }
}

export function formatDuration(startMs, endMs) {
  if (!startMs || !endMs) return '';
  try {
    const s = parseInt(startMs, 10);
    const e = parseInt(endMs, 10);
    if (isNaN(s) || isNaN(e) || s <= 0 || e <= 0 || e < s) return '';

    const diffSec = (e - s) / 1000;
    const diffHours = diffSec / 3600;

    if (diffSec < 60) {
      return '< 1 min';
    } else if (diffHours < 1.0) {
      const minutes = Math.round(diffSec / 60);
      return `${minutes} min`;
    } else if (diffHours < 24.0) {
      return `${diffHours.toFixed(1)} hrs`;
    } else {
      const days = Math.floor(diffHours / 24);
      const remHours = Math.round(diffHours % 24);
      return `${days}d ${remHours}h`;
    }
  } catch (_) {
    return '';
  }
}

// -------------------------------------------------------------
// STATUS COMPUTATION, STAGE METRICS & DIFF ENGINE
// -------------------------------------------------------------

export function normalizeStageName(rawName) {
  if (!rawName || typeof rawName !== 'string') return '';
  const trimmed = rawName.trim();
  if (!trimmed) return '';
  if (ALL_8_STAGES.includes(trimmed)) return trimmed;

  const compact = trimmed.replace(/\s+/g, ' ');

  if (/^(Acounting|Accounting|Accouting)\s+Processing\s*<\s*2000$/i.test(compact) || /^Acounting\s+Processing$/i.test(compact)) {
    return 'Acounting Processing <2000';
  }
  if (
    /^(Acounting|Accounting|Accouting)\s+Processing\s*>\s*2000$/i.test(compact) ||
    /^(Accounting|Accouting)\s+Processing$/i.test(compact)
  ) {
    return 'Accounting Processing > 2000';
  }
  if (/^Treasury\s+Processing(\s*>\s*2000)?$/i.test(compact)) {
    return 'Treasury Processing > 2000';
  }
  if (/^For\s+Check\s+Releasing(\s*>\s*2000)?$/i.test(compact)) {
    return 'For Check Releasing > 2000';
  }
  if (/^Team\s+Head/i.test(compact)) {
    return 'Team Head (if none, enter requester name)';
  }
  if (/^Department\s+Head/i.test(compact)) {
    return 'Department Head';
  }
  if (/^Approval$/i.test(compact)) {
    return 'Approval';
  }
  if (/^Receipt$/i.test(compact)) {
    return 'Receipt';
  }

  return compact;
}

export function computeOverallStatus(instStatus, stageFields = {}) {
  if (instStatus === 'REJECTED') return 'Rejected';
  if (instStatus === 'CANCELED') return 'Recalled';
  if (instStatus === 'DELETED') return 'Canceled';
  if (instStatus === 'APPROVED') return 'COMPLETED: Cash Advance Released';

  const isActive = (s) =>
    ['PENDING', 'APPROVED', 'COMPLETED', 'DONE', 'RESOLVED', 'AUTO-PASSED'].includes(stageFields[`${s} Action`]);

  if (isActive('Receipt')) {
    return 'Phase 4: Receipt Confirmation';
  }
  if (isActive('For Check Releasing > 2000') || isActive('Treasury Processing > 2000')) {
    return 'Phase 3: Treasury Processing & Check Release';
  }
  if (
    isActive('Accounting Processing > 2000') ||
    isActive('Acounting Processing <2000') ||
    isActive('Approval')
  ) {
    return 'Phase 2: Accounting Processing';
  }
  if (isActive('Team Head (if none, enter requester name)') || isActive('Department Head')) {
    return 'Phase 1: Line & Dept Review';
  }
  return 'Phase 1: Line & Dept Review';
}

export function extractStageMetrics(instanceData) {
  const metrics = {};
  if (!instanceData || typeof instanceData !== 'object') return metrics;
  const taskList = Array.isArray(instanceData.task_list) ? instanceData.task_list : [];

  const stageTasks = {};
  for (const tk of taskList) {
    if (!tk || typeof tk !== 'object') continue;
    const nodeId = tk.node_id;
    const stageName = (nodeId && NODE_ID_TO_STAGE[nodeId]) || normalizeStageName(tk.node_name);

    if (stageName) {
      if (!stageTasks[stageName]) {
        stageTasks[stageName] = [];
      }
      stageTasks[stageName].push(tk);
    }
  }

  for (const stage of ALL_8_STAGES) {
    const tasks = stageTasks[stage] || [];
    if (tasks.length === 0) continue;

    let latestTask = null;
    for (let i = tasks.length - 1; i >= 0; i--) {
      if (['APPROVED', 'REJECTED', 'COMPLETED', 'RESOLVED'].includes(tasks[i].status)) {
        latestTask = tasks[i];
        break;
      }
    }
    if (!latestTask) {
      for (let i = tasks.length - 1; i >= 0; i--) {
        if (['DONE', 'AUTO-PASSED'].includes(tasks[i].status)) {
          latestTask = tasks[i];
          break;
        }
      }
    }
    if (!latestTask) {
      latestTask = tasks[tasks.length - 1];
    }

    const openId = latestTask.open_id || latestTask.user_id;
    const startMs = latestTask.start_time;
    const endMs = latestTask.end_time;
    const action = latestTask.status;

    if (openId) {
      metrics[`${stage} Approver`] = [{ id: openId }];
    }
    if (startMs && String(startMs) !== '0') {
      const parsedStart = parseInt(startMs, 10);
      if (!isNaN(parsedStart) && parsedStart > 0) metrics[`${stage} Start`] = parsedStart;
    }
    if (endMs && String(endMs) !== '0') {
      const parsedEnd = parseInt(endMs, 10);
      if (!isNaN(parsedEnd) && parsedEnd > 0) metrics[`${stage} End`] = parsedEnd;
    }
    if (action) {
      metrics[`${stage} Action`] = action;
    }
  }

  return metrics;
}

export function extractFinancialFields(form) {
  let vendorBillNo = '';
  let checkNo = '';
  if (!form) return { vendorBillNo, checkNo };

  try {
    const formWidgets = typeof form === 'string' ? JSON.parse(form) : form;
    if (Array.isArray(formWidgets)) {
      for (const w of formWidgets) {
        if (!w || typeof w !== 'object') continue;
        const wName = typeof w.name === 'string' ? w.name.trim() : '';
        if (w.id === VENDOR_BILL_WIDGET_ID || wName === 'Vendor Bill No.') {
          vendorBillNo = extractText(w.value);
        } else if (w.id === CHECK_NO_WIDGET_ID || wName === 'Check No.') {
          checkNo = extractText(w.value);
        }
      }
    }
  } catch (_) {}

  return { vendorBillNo, checkNo };
}

export function diffTable2Fields(existingFields = {}, targetFields = {}) {
  const diff = {};
  const existing = existingFields || {};

  for (const [key, targetVal] of Object.entries(targetFields)) {
    if (targetVal === undefined) continue;
    const currentVal = existing[key];

    if (key === 'Requester' || key.endsWith(' Approver')) {
      const targetIds = normalizeUserField(targetVal).map((u) => u.id);
      const currentIds = normalizeUserField(currentVal).map((u) => u.id);
      if (targetIds.join(',') !== currentIds.join(',')) {
        diff[key] = targetVal;
      }
    } else if (key === 'Task ID') {
      const targetUrl = extractUrlField(targetVal);
      const currentUrl = extractUrlField(currentVal);
      if (targetUrl.text !== currentUrl.text || targetUrl.link !== currentUrl.link) {
        diff[key] = targetVal;
      }
    } else if (key.endsWith(' Start') || key.endsWith(' End')) {
      const targetMs = Number(targetVal);
      const currentMs = currentVal !== null && currentVal !== undefined ? Number(currentVal) : NaN;
      if (targetMs !== currentMs) {
        diff[key] = targetVal;
      }
    } else {
      if (extractText(currentVal) !== extractText(targetVal)) {
        diff[key] = targetVal;
      }
    }
  }

  return diff;
}

// -------------------------------------------------------------
// BITABLE PAGINATION & TERMINAL ROW FILTERING
// -------------------------------------------------------------

export async function fetchAllTableRecords(token, baseToken, tableId, budget) {
  const records = [];
  let pageToken = '';
  let complete = false;

  while (true) {
    if (budget && budget.used >= budget.limit) {
      break;
    }

    const pageParam = pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '';
    const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records?page_size=500&user_id_type=open_id${pageParam}`;

    if (budget) budget.used++;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch records for table ${tableId}: HTTP ${res.status}`);
    }

    const json = await res.json();
    if (json.code !== 0) {
      throw new Error(`Bitable API error for table ${tableId}: ${json.code} ${json.msg}`);
    }

    const data = json.data || {};
    if (Array.isArray(data.items)) {
      records.push(...data.items);
    }

    if (data.has_more && data.page_token) {
      pageToken = data.page_token;
    } else {
      complete = true;
      break;
    }
  }

  return { records, complete };
}

export function isSettledTerminalRow(t1Fields = {}, existingT2 = null) {
  if (!existingT2 || !existingT2.fields) return false;
  const t2Fields = existingT2.fields;
  const t2Status = extractText(t2Fields['Overall Status']);
  if (!TERMINAL_OVERALL_STATUSES.has(t2Status)) return false;

  const t1Status = extractText(t1Fields['Status']);
  if (t1Status === 'Processing' || t1Status === 'Pending' || t1Status === 'Under Review') {
    return false;
  }
  if (t2Status === 'COMPLETED: Cash Advance Released' && t1Status && t1Status !== 'Approved') {
    return false;
  }
  if (t2Status === 'Rejected' && t1Status && t1Status !== 'Rejected') {
    return false;
  }
  if (t2Status === 'Recalled' && t1Status && !['Recalled', 'Canceled'].includes(t1Status)) {
    return false;
  }
  if (t2Status === 'Canceled' && t1Status && !['Canceled', 'Deleted', 'Terminated'].includes(t1Status)) {
    return false;
  }

  // Ensure Task ID and Requester are already populated on Table 2 if present on Table 1
  const reqUrl = extractUrlField(t1Fields['Request No.']);
  if (reqUrl.link) {
    const t2Url = extractUrlField(t2Fields['Task ID']);
    if (t2Url.link !== reqUrl.link || t2Url.text !== reqUrl.text) return false;
  }
  const t1Users = normalizeUserField(t1Fields['Requester']);
  if (t1Users.length > 0) {
    const t2Users = normalizeUserField(t2Fields['Requester']);
    if (t1Users.map((u) => u.id).join(',') !== t2Users.map((u) => u.id).join(',')) return false;
  }

  // For APPROVED rows, verify financial auto-heal is not pending
  if (t2Status === 'COMPLETED: Cash Advance Released') {
    const hasVb = !!extractText(t1Fields['Vendor Bill No.']);
    const hasChk = !!extractText(t1Fields['Check No.']);
    if (hasVb && hasChk) return true;

    const rawAmt = t1Fields['Total Cash Advance Amount'];
    if (rawAmt !== undefined && rawAmt !== null && String(rawAmt).trim() !== '') {
      const amt = Number(rawAmt);
      if (!isNaN(amt) && amt <= 2000) {
        return true;
      }
    }
    return false;
  }

  return true;
}

// -------------------------------------------------------------
// CORE RECONCILIATION & AUTO-HEALING ENGINE
// -------------------------------------------------------------

export async function runAutoHealingCycle(env) {
  const budget = { used: 0, limit: MAX_SUBREQUESTS };
  const token = await getTenantAccessToken(env, budget);
  const baseToken = env.LARK_BASE_TOKEN;
  const mainTableId = env.LARK_MAIN_TABLE_ID;
  const logTableId = env.LARK_LOG_TABLE_ID;

  // 1. Fetch Table 1 records (paginated, page_size=500)
  const { records: t1Records } = await fetchAllTableRecords(token, baseToken, mainTableId, budget);

  // 2. Fetch Table 2 records (paginated, page_size=500)
  const { records: t2Records, complete: t2Complete } = await fetchAllTableRecords(token, baseToken, logTableId, budget);

  const t2MapByCode = {};
  for (const r of t2Records) {
    const fields = (r && r.fields) || {};
    const code = extractText(fields['Approval Instance Code']);
    if (code) t2MapByCode[code] = r;
  }

  let healedCount = 0;
  let updatedCount = 0;
  let table1HealedCount = 0;
  let skippedTerminalCount = 0;

  // Prioritize rows missing in Table 2 (0), then active/unsettled rows (1), then completed >2000 finance rechecks (2)
  const candidates = [];
  for (const t1Rec of t1Records) {
    const t1Fields = (t1Rec && t1Rec.fields) || {};
    const instanceCode = decodeInstanceCode(t1Fields.SourceID);
    if (!instanceCode) continue;

    const existingT2 = t2MapByCode[instanceCode] || null;
    const currentVb = extractText(t1Fields['Vendor Bill No.']);
    const currentChk = extractText(t1Fields['Check No.']);
    const financeCacheKey = `${instanceCode}:${currentVb}:${currentChk}`;

    if (
      isSettledTerminalRow(t1Fields, existingT2) ||
      (existingT2 &&
        extractText(existingT2.fields && existingT2.fields['Overall Status']) === 'COMPLETED: Cash Advance Released' &&
        exhaustedFinanceHealCache.has(financeCacheKey))
    ) {
      skippedTerminalCount++;
      continue;
    }

    let priority = 0;
    if (existingT2) {
      const t2Status = extractText(existingT2.fields && existingT2.fields['Overall Status']);
      const isTerminalFinanceOnlyRecheck =
        t2Status === 'COMPLETED: Cash Advance Released' &&
        isSettledTerminalRow({ ...t1Fields, 'Vendor Bill No.': 'VB', 'Check No.': 'CHK' }, existingT2);
      priority = isTerminalFinanceOnlyRecheck ? 2 : 1;
    }
    candidates.push({ t1Rec, t1Fields, instanceCode, existingT2, priority });
  }

  candidates.sort((a, b) => a.priority - b.priority);

  for (const item of candidates) {
    // Require at least 2 remaining subrequests (1 for Approval instance GET + at least 1 for Table 1/2 write)
    if (budget.used + 1 >= budget.limit) {
      console.log(`[!] Subrequest budget limit reached (${budget.used}/50). Yielding to next cycle.`);
      break;
    }

    const { t1Rec, t1Fields, instanceCode, existingT2 } = item;
    const sourceIdText = extractText(t1Fields.SourceID);
    const reqUrl = extractUrlField(t1Fields['Request No.']);

    // Fetch live approval instance
    budget.used++;
    const instRes = await fetch(`https://open.larksuite.com/open-apis/approval/v4/instances/${instanceCode}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!instRes.ok) continue;

    const instJson = await instRes.json().catch(() => ({}));
    if (instJson.code !== 0 || !instJson.data) continue;
    const instData = instJson.data;

    const reqNoText = reqUrl.text || (instData.serial_number ? String(instData.serial_number).trim() : '');
    const reqNoLink = reqUrl.link;

    // Auto-heal financial fields (Vendor Bill No. & Check No.) back to Table 1 if available
    const { vendorBillNo, checkNo } = extractFinancialFields(instData.form);
    let effectiveVb = extractText(t1Fields['Vendor Bill No.']);
    let effectiveChk = extractText(t1Fields['Check No.']);

    const t1Updates = {};
    if (vendorBillNo && !effectiveVb) {
      t1Updates['Vendor Bill No.'] = vendorBillNo;
    }
    if (checkNo && !effectiveChk) {
      t1Updates['Check No.'] = checkNo;
    }
    if (Object.keys(t1Updates).length > 0 && budget.used < budget.limit) {
      budget.used++;
      const t1UpdateRes = await fetch(
        `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseToken}/tables/${mainTableId}/records/${t1Rec.record_id}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ fields: t1Updates }),
        }
      );
      const t1UpdateJson = await t1UpdateRes.json().catch(() => ({}));
      if (t1UpdateJson.code === 0) {
        table1HealedCount++;
        if (t1Updates['Vendor Bill No.']) effectiveVb = t1Updates['Vendor Bill No.'];
        if (t1Updates['Check No.']) effectiveChk = t1Updates['Check No.'];
      } else {
        console.error(`[Table 1 Financial Auto-Heal Error] ${t1UpdateJson.code}: ${t1UpdateJson.msg}`);
      }
    }

    // If instance is terminal APPROVED and Approval form had no further financial fields to heal, cache exhaustion state
    if (instData.status === 'APPROVED' && (!effectiveVb || !effectiveChk)) {
      const canStillHealVb = Boolean(vendorBillNo && !effectiveVb);
      const canStillHealChk = Boolean(checkNo && !effectiveChk);
      if (!canStillHealVb && !canStillHealChk) {
        exhaustedFinanceHealCache.add(`${instanceCode}:${effectiveVb}:${effectiveChk}`);
      }
    }

    // Process Table 2 (Step Approval Log: tbliGywXHe6qMIm6)
    const stageMetrics = extractStageMetrics(instData);
    const overallStatus = computeOverallStatus(instData.status, stageMetrics);

    const targetT2Fields = {
      'Approval Instance Code': instanceCode,
      'Request No': reqNoText,
      'Overall Status': overallStatus,
      ...stageMetrics,
    };
    if (sourceIdText) {
      targetT2Fields['SourceID'] = sourceIdText;
    }
    if (reqNoLink) {
      targetT2Fields['Task ID'] = { text: reqNoText, link: reqNoLink };
    }
    const normalizedRequesters = normalizeUserField(t1Fields.Requester, instData.open_id);
    if (normalizedRequesters.length > 0) {
      targetT2Fields['Requester'] = normalizedRequesters;
    }

    if (!existingT2) {
      // Only POST if Table 2 listing completed cleanly (prevents duplicate POSTs on truncated pagination)
      if (t2Complete && budget.used < budget.limit) {
        budget.used++;
        const postT2Res = await fetch(
          `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseToken}/tables/${logTableId}/records`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ fields: targetT2Fields }),
          }
        );
        const postT2Json = await postT2Res.json().catch(() => ({}));
        if (postT2Json.code === 0) {
          healedCount++;
          if (postT2Json.data && postT2Json.data.record) {
            t2MapByCode[instanceCode] = postT2Json.data.record;
          }
        } else {
          console.error(`[Table 2 POST Error] ${postT2Json.code}: ${postT2Json.msg}`);
        }
      }
    } else {
      const diffFields = diffTable2Fields(existingT2.fields, targetT2Fields);
      if (Object.keys(diffFields).length > 0 && budget.used < budget.limit) {
        budget.used++;
        const putT2Res = await fetch(
          `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseToken}/tables/${logTableId}/records/${existingT2.record_id}`,
          {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ fields: diffFields }),
          }
        );
        const putT2Json = await putT2Res.json().catch(() => ({}));
        if (putT2Json.code === 0) {
          updatedCount++;
        } else {
          console.error(`[Table 2 PUT Error] ${putT2Json.code}: ${putT2Json.msg}`);
        }
      }
    }
  }

  return {
    healedCount,
    updatedCount,
    table1HealedCount,
    skippedTerminalCount,
    subrequestsUsed: budget.used,
    totalTable1: t1Records.length,
  };
}

// -------------------------------------------------------------
// WORKER EVENT HANDLERS (Fetch & Scheduled Cron)
// -------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health Check Endpoint
    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(
        JSON.stringify(
          {
            status: 'healthy',
            service: 'cash-advance-non-travel',
            version: '1.0.0',
            metrics: serviceMetrics,
            cachedToken: !!tokenCache.token,
            tokenExpiresInSec: tokenCache.expiresAt
              ? Math.max(0, Math.round((tokenCache.expiresAt - Date.now()) / 1000))
              : 0,
          },
          null,
          2
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Instant Sync Webhook from AnyCross
    if (url.pathname === '/sync') {
      if (request.method && !['GET', 'POST'].includes(request.method.toUpperCase())) {
        return new Response(JSON.stringify({ code: 405, msg: 'Method Not Allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      serviceMetrics.webhooksReceived++;
      const jobPromise = runAutoHealingCycle(env)
        .then((res) => {
          serviceMetrics.instancesCreated += res.healedCount;
          serviceMetrics.instancesUpdated += res.updatedCount;
          serviceMetrics.table1Healed += res.table1HealedCount;
          console.log(
            `[Sync Completed] Created: ${res.healedCount}, Updated: ${res.updatedCount}, T1 Healed: ${res.table1HealedCount}, Subrequests: ${res.subrequestsUsed}`
          );
        })
        .catch((err) => {
          console.error('[Sync Error]', err);
        });

      // Immediately acknowledge HTTP 200 within <20ms
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(jobPromise);
      } else {
        await jobPromise;
      }

      return new Response(JSON.stringify({ code: 0, msg: 'Sync job scheduled' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    serviceMetrics.cronsExecuted++;
    serviceMetrics.lastCronTime = new Date().toISOString();
    const cronPromise = runAutoHealingCycle(env)
      .then((res) => {
        serviceMetrics.instancesCreated += res.healedCount;
        serviceMetrics.instancesUpdated += res.updatedCount;
        serviceMetrics.table1Healed += res.table1HealedCount;
      })
      .catch((err) => {
        console.error('[Cron Error]', err);
      });

    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(cronPromise);
    } else {
      await cronPromise;
    }
  },
};
