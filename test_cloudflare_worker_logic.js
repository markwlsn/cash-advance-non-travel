/**
 * Comprehensive Unit & Simulated Integration Test Suite for
 * Lark Cash Advance (Non-Travel) Cloudflare Worker Logic
 * -------------------------------------------------------------------
 * Zero external npm dependencies. Covers pure functions, edge cases,
 * and full mocked Lark OpenAPI fetch()/scheduled() auto-healing cycles.
 */

import worker, {
  ALL_8_STAGES,
  NODE_ID_TO_STAGE,
  MAX_SUBREQUESTS,
  VENDOR_BILL_WIDGET_ID,
  CHECK_NO_WIDGET_ID,
  extractText,
  extractUrlField,
  normalizeUserField,
  normalizeStageName,
  decodeInstanceCode,
  formatTimestamp,
  formatDuration,
  extractStageMetrics,
  extractFinancialFields,
  computeOverallStatus,
  diffTable2Fields,
  isSettledTerminalRow,
  fetchAllTableRecords,
  runAutoHealingCycle,
  getTenantAccessToken,
  resetTokenCache,
  serviceMetrics,
} from './cloudflare_worker.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${message}`);
  } else {
    console.error(`  [FAIL] ${message}`);
  }
}

// ---------------------------------------------------------------------------
// SUITE 1: Stage & Node ID Verification (D375F005-FCC9-4AA7-8B03-683AA17F4997)
// ---------------------------------------------------------------------------
console.log('--- TEST SUITE 1: Stage & Node ID Verification ---');
assert(ALL_8_STAGES.length === 8, 'ALL_8_STAGES has exactly 8 canonical stages');
assert(Object.keys(NODE_ID_TO_STAGE).length === 8, 'NODE_ID_TO_STAGE has exactly 8 nodes mapped');
assert(
  NODE_ID_TO_STAGE['c1e48274b814fdce8dc77ddc6be0cd82'] === 'Team Head (if none, enter requester name)',
  'Node ID for Team Head matches'
);
assert(NODE_ID_TO_STAGE['2bc64761cd7fa34d3905a13b982c73f2'] === 'Department Head', 'Node ID for Department Head matches');
assert(
  NODE_ID_TO_STAGE['b42dc2a7ceae426ff6a9f683db746ac2'] === 'Acounting Processing <2000',
  'Node ID for Acounting Processing <2000 matches exact Table 2 header'
);
assert(
  NODE_ID_TO_STAGE['0d47568655d7427088adc32db11e6dea'] === 'Accounting Processing > 2000',
  'Node ID for Accounting Processing > 2000 matches'
);
assert(
  NODE_ID_TO_STAGE['cc9562b8bb3b689f4051b9f64610f557'] === 'Treasury Processing > 2000',
  'Node ID for Treasury Processing > 2000 matches'
);
assert(
  NODE_ID_TO_STAGE['42fbf264c757382bea8706424f06dd8e'] === 'For Check Releasing > 2000',
  'Node ID for For Check Releasing > 2000 matches'
);
assert(NODE_ID_TO_STAGE['6303e52fcf398a2d8df73b79b144a6d4'] === 'Approval', 'Node ID for Approval (==2000 branch) matches');
assert(NODE_ID_TO_STAGE['1750beb4c4c8c6afe329c07dd4ea6028'] === 'Receipt', 'Node ID for Receipt matches');

assert(
  normalizeStageName('Acounting Processing') === 'Acounting Processing <2000',
  'Raw node name "Acounting Processing" normalizes to "Acounting Processing <2000"'
);
assert(
  normalizeStageName('Accounting Processing < 2000') === 'Acounting Processing <2000',
  'Variant "Accounting Processing < 2000" normalizes to "Acounting Processing <2000"'
);
assert(
  normalizeStageName('Accounting Processing') === 'Accounting Processing > 2000',
  'Raw node name "Accounting Processing" normalizes to "Accounting Processing > 2000"'
);
assert(
  normalizeStageName('Accouting Processing >2000') === 'Accounting Processing > 2000',
  'Typo variant "Accouting Processing >2000" normalizes to "Accounting Processing > 2000"'
);
assert(
  normalizeStageName('Treasury Processing') === 'Treasury Processing > 2000',
  'Raw node name "Treasury Processing" normalizes to "Treasury Processing > 2000"'
);
assert(
  normalizeStageName('For Check Releasing') === 'For Check Releasing > 2000',
  'Raw node name "For Check Releasing" normalizes to "For Check Releasing > 2000"'
);

// ---------------------------------------------------------------------------
// SUITE 2: SourceID Base64 Decoding & Field Normalization
// ---------------------------------------------------------------------------
console.log('\n--- TEST SUITE 2: SourceID Base64 Decoding & Field Normalization ---');
const liveCaB64 =
  'NzcwOTUzOTM3Nzk2NTI0MDA3MDo3RjNEMEQ5Ri1DNzRDLTQ1MDctOTkzQy04OEI3Rjc5REEwQkQ6Mjc3MzNiYWI4M2Q0MDlhNGY3OGFhZDNhNjMwNzAzNjA6MQ==';
assert(
  decodeInstanceCode(liveCaB64) === '7F3D0D9F-C74C-4507-993C-88B7F79DA0BD',
  'Decodes live Cash Advance 4-part Base64 SourceID to instance GUID'
);
assert(
  decodeInstanceCode([{ type: 'text', text: liveCaB64 }]) === '7F3D0D9F-C74C-4507-993C-88B7F79DA0BD',
  'Decodes Bitable rich-text array SourceID to instance GUID'
);
assert(decodeInstanceCode('RAW-GUID-1234') === 'RAW-GUID-1234', 'Gracefully preserves unencoded GUID with hyphens');
assert(decodeInstanceCode('INSTANCE1234') === 'INSTANCE1234', 'Gracefully preserves unencoded alphanumeric ID');
assert(
  decodeInstanceCode('VGVzdDEy') === 'VGVzdDEy',
  'Preserves raw alphanumeric ID "VGVzdDEy" instead of corrupting via non-colon Base64 ASCII decode'
);
assert(
  decodeInstanceCode(btoa('7F3D0D9F-C74C-4507-993C-88B7F79DA0BD')) === '7F3D0D9F-C74C-4507-993C-88B7F79DA0BD',
  'Decodes Base64-encoded bare GUID string'
);
assert(decodeInstanceCode('') === null, 'Empty string returns null');
assert(decodeInstanceCode('   ') === null, 'Whitespace-only string returns null');
assert(decodeInstanceCode(null) === null, 'Null returns null');
assert(decodeInstanceCode(undefined) === null, 'Undefined returns null');

const liveUrlArr = [
  {
    type: 'url',
    text: '202609280009',
    link: 'https://applink.larksuite.com/client/mini_program/open?instanceId=7690423678500376286',
  },
];
const extractedUrl = extractUrlField(liveUrlArr);
assert(
  extractedUrl.text === '202609280009' &&
    extractedUrl.link === 'https://applink.larksuite.com/client/mini_program/open?instanceId=7690423678500376286',
  'extractUrlField unwraps Bitable URL array [{ type: "url", text, link }]'
);
assert(
  extractUrlField({ text: '202609280010', link: 'https://larksuite.com/a' }).link === 'https://larksuite.com/a',
  'extractUrlField handles URL object { text, link }'
);

const normUsers = normalizeUserField([{ id: 'ou_111', name: 'Test User', en_name: 'Test User' }]);
assert(
  normUsers.length === 1 && normUsers[0].id === 'ou_111' && Object.keys(normUsers[0]).length === 1,
  'normalizeUserField strips extra Bitable metadata and preserves [{ id }]'
);
assert(
  normalizeUserField(null, 'ou_fallback')[0].id === 'ou_fallback',
  'normalizeUserField uses fallback open_id when primary value is empty'
);

// ---------------------------------------------------------------------------
// SUITE 3: Duration & Manila Timestamp Formatting (UTC+8)
// ---------------------------------------------------------------------------
console.log('\n--- TEST SUITE 3: Duration & Manila Timestamp Formatting ---');
assert(formatDuration(1000, 31000) === '< 1 min', '< 1 min duration formatted correctly');
assert(formatDuration(1000, 181000) === '3 min', 'Minutes formatted correctly');
assert(formatDuration(1000, 1000 + 2.5 * 3600 * 1000) === '2.5 hrs', 'Hours formatted with single decimal');
assert(formatDuration(1000, 1000 + 28 * 3600 * 1000) === '1d 4h', 'Days and hours formatted correctly');
assert(formatDuration(0, 0) === '', 'Zero start/end returns empty string');
assert(formatDuration(5000, 1000) === '', 'Negative duration returns empty string');

const epochTest = 1731218400000;
const formattedTs = formatTimestamp(epochTest);
assert(formattedTs.length === 19 && formattedTs.includes(':'), `Formats epoch to Manila UTC+8 timestamp (${formattedTs})`);
assert(formatTimestamp(null) === '', 'Null timestamp returns empty string');
assert(formatTimestamp('0') === '', 'Zero string timestamp returns empty string');

// ---------------------------------------------------------------------------
// SUITE 4: Overall Status Progressive Phase Logic (Cash Advance 4-Phase Flow)
// ---------------------------------------------------------------------------
console.log('\n--- TEST SUITE 4: Overall Status Progressive Phase Logic ---');
assert(computeOverallStatus('REJECTED', {}) === 'Rejected', 'REJECTED instance returns Rejected');
assert(computeOverallStatus('CANCELED', {}) === 'Recalled', 'CANCELED instance returns Recalled');
assert(computeOverallStatus('DELETED', {}) === 'Canceled', 'DELETED instance returns Canceled');
assert(
  computeOverallStatus('APPROVED', {}) === 'COMPLETED: Cash Advance Released',
  'APPROVED instance returns COMPLETED: Cash Advance Released'
);
assert(computeOverallStatus('PENDING', {}) === 'Phase 1: Line & Dept Review', 'Empty stage fields default to Phase 1');
assert(
  computeOverallStatus('PENDING', { 'Team Head (if none, enter requester name) Action': 'PENDING' }) ===
    'Phase 1: Line & Dept Review',
  'Team Head active returns Phase 1: Line & Dept Review'
);
assert(
  computeOverallStatus('PENDING', { 'Department Head Action': 'DONE' }) === 'Phase 1: Line & Dept Review',
  'Department Head active returns Phase 1: Line & Dept Review'
);
assert(
  computeOverallStatus('PENDING', { 'Acounting Processing <2000 Action': 'PENDING' }) === 'Phase 2: Accounting Processing',
  'Acounting Processing <2000 active returns Phase 2: Accounting Processing'
);
assert(
  computeOverallStatus('PENDING', { 'Accounting Processing > 2000 Action': 'APPROVED' }) ===
    'Phase 2: Accounting Processing',
  'Accounting Processing > 2000 active returns Phase 2: Accounting Processing'
);
assert(
  computeOverallStatus('PENDING', { 'Approval Action': 'PENDING' }) === 'Phase 2: Accounting Processing',
  'Approval (==2000 branch) active returns Phase 2: Accounting Processing'
);
assert(
  computeOverallStatus('PENDING', { 'Treasury Processing > 2000 Action': 'PENDING' }) ===
    'Phase 3: Treasury Processing & Check Release',
  'Treasury Processing > 2000 active returns Phase 3: Treasury Processing & Check Release'
);
assert(
  computeOverallStatus('PENDING', { 'For Check Releasing > 2000 Action': 'APPROVED' }) ===
    'Phase 3: Treasury Processing & Check Release',
  'For Check Releasing > 2000 active returns Phase 3: Treasury Processing & Check Release'
);
assert(
  computeOverallStatus('PENDING', {
    'Team Head (if none, enter requester name) Action': 'APPROVED',
    'Department Head Action': 'DONE',
    'Approval Action': 'APPROVED',
    'Receipt Action': 'PENDING',
  }) === 'Phase 4: Receipt Confirmation',
  'Receipt active takes highest phase precedence -> Phase 4: Receipt Confirmation'
);

// ---------------------------------------------------------------------------
// SUITE 5: Stage Metrics & Financial Widget Extraction
// ---------------------------------------------------------------------------
console.log('\n--- TEST SUITE 5: Stage Metrics & Financial Widget Extraction ---');
const liveCaInstance = {
  approval_code: 'D375F005-FCC9-4AA7-8B03-683AA17F4997',
  status: 'APPROVED',
  serial_number: '202609280009',
  task_list: [
    {
      node_id: 'c1e48274b814fdce8dc77ddc6be0cd82',
      node_name: 'Team Head (if none, enter requester name)',
      open_id: 'ou_teamhead01',
      start_time: '1759024200000',
      end_time: '1759024260000',
      status: 'APPROVED',
    },
    {
      node_id: '2bc64761cd7fa34d3905a13b982c73f2',
      node_name: 'Department Head',
      open_id: 'ou_teamhead01',
      start_time: '1759024260000',
      end_time: '1759024261000',
      status: 'DONE',
    },
    {
      node_id: '6303e52fcf398a2d8df73b79b144a6d4',
      node_name: 'Approval',
      open_id: 'ou_approver2000',
      start_time: '1759024262000',
      end_time: '1759025000000',
      status: 'APPROVED',
    },
    {
      node_id: '1750beb4c4c8c6afe329c07dd4ea6028',
      node_name: 'Receipt',
      open_id: 'ou_requester01',
      start_time: '1759025001000',
      end_time: '1759026000000',
      status: 'APPROVED',
    },
  ],
};

const caMetrics = extractStageMetrics(liveCaInstance);
assert(
  caMetrics['Team Head (if none, enter requester name) Approver'][0].id === 'ou_teamhead01',
  'Team Head approver extracted correctly'
);
assert(
  caMetrics['Team Head (if none, enter requester name) Start'] === 1759024200000 &&
    caMetrics['Team Head (if none, enter requester name) End'] === 1759024260000,
  'Team Head Start and End numeric timestamps extracted'
);
assert(caMetrics['Department Head Action'] === 'DONE', 'Department Head AUTO-PASS/DONE status extracted');
assert(caMetrics['Approval Action'] === 'APPROVED', 'Approval (==2000 branch) status extracted');
assert(caMetrics['Receipt Action'] === 'APPROVED', 'Receipt confirmation status extracted');
assert(
  !Object.keys(caMetrics).some((k) => k.endsWith(' Duration')),
  'extractStageMetrics emits zero Duration fields (preserving Type 20 Bitable formulas)'
);
assert(
  caMetrics['Acounting Processing <2000 Action'] === undefined,
  'Unvisited branch stages are omitted rather than polluted'
);

// Test multi-task stage selection (transfer/retry) + fallback by raw node_name
const retryInstance = {
  task_list: [
    {
      node_id: 'unknown_node_id',
      node_name: 'Acounting Processing',
      open_id: 'ou_acc_first',
      start_time: '1759024000000',
      end_time: '1759024100000',
      status: 'APPROVED',
    },
    {
      node_id: 'unknown_node_id',
      node_name: 'Acounting Processing',
      open_id: 'ou_acc_extra',
      start_time: '1759024000000',
      end_time: '0',
      status: 'PENDING',
    },
  ],
};
const retryMetrics = extractStageMetrics(retryInstance);
assert(
  retryMetrics['Acounting Processing <2000 Approver'][0].id === 'ou_acc_first' &&
    retryMetrics['Acounting Processing <2000 Action'] === 'APPROVED' &&
    retryMetrics['Acounting Processing <2000 End'] === 1759024100000,
  'Prefers completed task over trailing PENDING sibling task and normalizes "Acounting Processing"'
);

// Test OR-node with 2 assignees where tasks[0] clicked Approve (APPROVED) and tasks[1] was auto-closed (DONE)
const orNodeInstance = {
  task_list: [
    {
      node_id: 'b42dc2a7ceae426ff6a9f683db746ac2',
      node_name: 'Acounting Processing',
      open_id: 'ou_real_approver',
      start_time: '1759024000000',
      end_time: '1759024150000',
      status: 'APPROVED',
    },
    {
      node_id: 'b42dc2a7ceae426ff6a9f683db746ac2',
      node_name: 'Acounting Processing',
      open_id: 'ou_passive_or_assignee',
      start_time: '1759024000000',
      end_time: '1759024150000',
      status: 'DONE',
    },
  ],
};
const orNodeMetrics = extractStageMetrics(orNodeInstance);
assert(
  orNodeMetrics['Acounting Processing <2000 Approver'][0].id === 'ou_real_approver' &&
    orNodeMetrics['Acounting Processing <2000 Action'] === 'APPROVED',
  'OR-node selects actual APPROVED decision-maker over trailing auto-closed DONE task'
);

const sampleFinanceForm = JSON.stringify([
  { id: VENDOR_BILL_WIDGET_ID, name: 'Vendor Bill No.', value: 'VB-2026-0091' },
  { id: CHECK_NO_WIDGET_ID, name: 'Check No.', value: 'CHK-884120' },
]);
const fin = extractFinancialFields(sampleFinanceForm);
assert(
  fin.vendorBillNo === 'VB-2026-0091' && fin.checkNo === 'CHK-884120',
  'Extracts Vendor Bill No. and Check No. from Approval form JSON'
);
assert(
  extractFinancialFields('invalid-json').vendorBillNo === '',
  'Malformed form JSON returns empty financial fields without throwing'
);

// ---------------------------------------------------------------------------
// SUITE 6: Type-Aware Diff Engine & Settled Terminal Row Guard
// ---------------------------------------------------------------------------
console.log('\n--- TEST SUITE 6: Type-Aware Diff Engine & Settled Terminal Row Guard ---');
const existingBitableT2Fields = {
  'Approval Instance Code': '7F3D0D9F-C74C-4507-993C-88B7F79DA0BD',
  'Request No': [{ type: 'text', text: '202609280009' }],
  'SourceID': liveCaB64,
  'Overall Status': 'Phase 4: Receipt Confirmation',
  'Task ID': [{ type: 'url', text: '202609280009', link: 'https://applink.larksuite.com/ca/1' }],
  'Requester': [{ id: 'ou_requester01', name: 'Juan Dela Cruz', en_name: 'Juan Dela Cruz' }],
  'Receipt Approver': [{ id: 'ou_requester01', name: 'Juan Dela Cruz' }],
  'Receipt Start': 1759025001000,
  'Receipt Action': 'PENDING',
};

const identicalTargetFields = {
  'Approval Instance Code': '7F3D0D9F-C74C-4507-993C-88B7F79DA0BD',
  'Request No': '202609280009',
  'SourceID': liveCaB64,
  'Overall Status': 'Phase 4: Receipt Confirmation',
  'Task ID': { text: '202609280009', link: 'https://applink.larksuite.com/ca/1' },
  'Requester': [{ id: 'ou_requester01' }],
  'Receipt Approver': [{ id: 'ou_requester01' }],
  'Receipt Start': 1759025001000,
  'Receipt Action': 'PENDING',
};

const noOpDiff = diffTable2Fields(existingBitableT2Fields, identicalTargetFields);
assert(
  Object.keys(noOpDiff).length === 0,
  'diffTable2Fields ignores enriched Bitable User/URL metadata and returns 0 false diffs'
);

const progressedTargetFields = {
  ...identicalTargetFields,
  'Overall Status': 'COMPLETED: Cash Advance Released',
  'Receipt End': 1759026000000,
  'Receipt Action': 'APPROVED',
};
const surgicalDiff = diffTable2Fields(existingBitableT2Fields, progressedTargetFields);
assert(
  Object.keys(surgicalDiff).length === 3 &&
    surgicalDiff['Overall Status'] === 'COMPLETED: Cash Advance Released' &&
    surgicalDiff['Receipt End'] === 1759026000000 &&
    surgicalDiff['Receipt Action'] === 'APPROVED',
  'diffTable2Fields emits only the 3 changed fields on stage completion'
);

// Test settled terminal row detection
const settledT1_2000 = {
  'Request No.': liveUrlArr,
  'Status': 'Approved',
  'Requester': [{ id: 'ou_requester01', name: 'Juan' }],
  'Total Cash Advance Amount': 2000,
  'Vendor Bill No.': null,
  'Check No.': null,
};
const settledT2_2000 = {
  record_id: 'recT2_1',
  fields: {
    'Overall Status': 'COMPLETED: Cash Advance Released',
    'Task ID': liveUrlArr,
    'Requester': [{ id: 'ou_requester01' }],
  },
};
assert(
  isSettledTerminalRow(settledT1_2000, settledT2_2000) === true,
  'isSettledTerminalRow skips <= 2000 COMPLETED row even when Vendor Bill/Check No. are null'
);

const unsettledT1_5000 = {
  ...settledT1_2000,
  'Total Cash Advance Amount': 5000,
  'Vendor Bill No.': null,
  'Check No.': null,
};
assert(
  isSettledTerminalRow(unsettledT1_5000, settledT2_2000) === false,
  'isSettledTerminalRow does NOT skip > 2000 COMPLETED row when Vendor Bill/Check No. are still blank'
);
assert(
  isSettledTerminalRow(
    { ...unsettledT1_5000, 'Vendor Bill No.': 'VB-1', 'Check No.': 'CHK-1' },
    settledT2_2000
  ) === true,
  'isSettledTerminalRow skips > 2000 COMPLETED row once Vendor Bill & Check No. are healed'
);

// ---------------------------------------------------------------------------
// MOCK LARK OPENAPI HARNESS FOR SIMULATED END-TO-END WORKER VERIFICATION
// ---------------------------------------------------------------------------
function createMockLarkEnvironment(initialState = {}) {
  const state = {
    authCalls: 0,
    subrequests: 0,
    requestsLog: [],
    t1Pages: initialState.t1Pages || [[]],
    t2Pages: initialState.t2Pages || [[]],
    instances: initialState.instances || {},
    t1PutUpdates: [],
    t2PostCreates: [],
    t2PutUpdates: [],
    failAuth: initialState.failAuth || false,
  };

  const env = {
    LARK_APP_ID: 'cli_aa74f7f23ab8df04',
    LARK_APP_SECRET: 'mock_test_secret_do_not_use_in_prod',
    LARK_BASE_TOKEN: 'ZMxobOBv0aW8AosmOhflq4IagBe',
    LARK_MAIN_TABLE_ID: 'tblIbyc67hpYTyiI',
    LARK_LOG_TABLE_ID: 'tbliGywXHe6qMIm6',
    LARK_APPROVAL_CODE: 'D375F005-FCC9-4AA7-8B03-683AA17F4997',
  };

  const mockFetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    state.subrequests++;
    state.requestsLog.push({ method, url, body });

    // 1. Auth Endpoint
    if (url.includes('/open-apis/auth/v3/tenant_access_token/internal')) {
      state.authCalls++;
      if (state.failAuth) {
        return new Response(JSON.stringify({ code: 10014, msg: 'invalid app_secret' }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ code: 0, msg: 'ok', tenant_access_token: 't-mock_token_123', expire: 7200 }),
        { status: 200 }
      );
    }

    // 2. Table 1 (tblIbyc67hpYTyiI) GET / PUT
    if (url.includes(`/tables/${env.LARK_MAIN_TABLE_ID}/records`)) {
      if (method === 'GET') {
        const u = new URL(url);
        const pageIdx = u.searchParams.get('page_token') ? parseInt(u.searchParams.get('page_token'), 10) : 0;
        const items = state.t1Pages[pageIdx] || [];
        const hasMore = pageIdx + 1 < state.t1Pages.length;
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              items,
              has_more: hasMore,
              page_token: hasMore ? String(pageIdx + 1) : '',
            },
          }),
          { status: 200 }
        );
      }
      if (method === 'PUT') {
        const recId = url.split('/records/')[1];
        state.t1PutUpdates.push({ record_id: recId, fields: body.fields });
        for (const page of state.t1Pages) {
          for (const r of page) {
            if (r.record_id === recId) {
              Object.assign(r.fields, body.fields);
            }
          }
        }
        return new Response(JSON.stringify({ code: 0, data: { record: { record_id: recId, fields: body.fields } } }), {
          status: 200,
        });
      }
    }

    // 3. Table 2 (tbliGywXHe6qMIm6) GET / POST / PUT
    if (url.includes(`/tables/${env.LARK_LOG_TABLE_ID}/records`)) {
      if (method === 'GET') {
        const u = new URL(url);
        const pageIdx = u.searchParams.get('page_token') ? parseInt(u.searchParams.get('page_token'), 10) : 0;
        const items = state.t2Pages[pageIdx] || [];
        const hasMore = pageIdx + 1 < state.t2Pages.length;
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              items,
              has_more: hasMore,
              page_token: hasMore ? String(pageIdx + 1) : '',
            },
          }),
          { status: 200 }
        );
      }
      if (method === 'POST') {
        const newRec = {
          record_id: `recT2_created_${state.t2PostCreates.length + 1}`,
          fields: { ...body.fields },
        };
        state.t2PostCreates.push(newRec);
        state.t2Pages[0].push(newRec);
        return new Response(JSON.stringify({ code: 0, data: { record: newRec } }), { status: 200 });
      }
      if (method === 'PUT') {
        const recId = url.split('/records/')[1];
        state.t2PutUpdates.push({ record_id: recId, fields: body.fields });
        for (const page of state.t2Pages) {
          for (const r of page) {
            if (r.record_id === recId) {
              Object.assign(r.fields, body.fields);
            }
          }
        }
        return new Response(JSON.stringify({ code: 0, data: { record: { record_id: recId, fields: body.fields } } }), {
          status: 200,
        });
      }
    }

    // 4. Approval v4 Instance Endpoint
    if (url.includes('/open-apis/approval/v4/instances/')) {
      const code = url.split('/instances/')[1];
      const inst = state.instances[code];
      if (!inst) {
        return new Response(JSON.stringify({ code: 1390002, msg: 'instance not found' }), { status: 404 });
      }
      return new Response(JSON.stringify({ code: 0, data: inst }), { status: 200 });
    }

    return new Response('Unhandled mock URL', { status: 500 });
  };

  return { state, env, mockFetch };
}

// ---------------------------------------------------------------------------
// SUITE 7: Simulated HTTP fetch() Endpoints & Token Cache Verification
// ---------------------------------------------------------------------------
console.log('\n--- TEST SUITE 7: Simulated HTTP fetch() Endpoints & Token Cache ---');
const originalFetch = globalThis.fetch;

try {
  resetTokenCache();
  const { state: s7, env: env7, mockFetch: mf7 } = createMockLarkEnvironment();
  globalThis.fetch = mf7;

  // Test GET /health
  const healthRes = await worker.fetch(new Request('https://cash-advance-non-travel-watchdog.workers.dev/health'), env7, {});
  const healthJson = await healthRes.json();
  assert(
    healthRes.status === 200 &&
      healthJson.status === 'healthy' &&
      healthJson.service === 'cash-advance-non-travel-watchdog',
    'GET /health returns 200 healthy JSON for cash-advance-non-travel-watchdog'
  );

  // Test GET /unknown -> 404
  const notFoundRes = await worker.fetch(
    new Request('https://cash-advance-non-travel-watchdog.workers.dev/unknown'),
    env7,
    {}
  );
  assert(notFoundRes.status === 404, 'GET /unknown returns HTTP 404');

  // Test DELETE /sync -> 405
  const methodRes = await worker.fetch(
    new Request('https://cash-advance-non-travel-watchdog.workers.dev/sync', { method: 'DELETE' }),
    env7,
    {}
  );
  assert(methodRes.status === 405, 'DELETE /sync returns HTTP 405 Method Not Allowed');

  // Test AnyCross GET /sync with ctx.waitUntil
  const waitUntilPromises = [];
  const mockCtx = {
    waitUntil(p) {
      waitUntilPromises.push(p);
    },
  };
  const beforeWebhooks = serviceMetrics.webhooksReceived;
  const syncRes = await worker.fetch(
    new Request('https://cash-advance-non-travel-watchdog.workers.dev/sync', { method: 'GET' }),
    env7,
    mockCtx
  );
  const syncJson = await syncRes.json();
  await Promise.all(waitUntilPromises);

  assert(
    syncRes.status === 200 && syncJson.code === 0 && syncJson.msg === 'Sync job scheduled',
    'AnyCross GET /sync returns HTTP 200 { code: 0, msg: "Sync job scheduled" }'
  );
  assert(
    waitUntilPromises.length === 1 && serviceMetrics.webhooksReceived === beforeWebhooks + 1,
    'GET /sync schedules background reconciliation via ctx.waitUntil and increments webhooksReceived'
  );
  assert(s7.authCalls === 1, 'First cycle fetches tenant_access_token once');

  // Second GET /sync reuses cached token
  await worker.fetch(new Request('https://cash-advance-non-travel-watchdog.workers.dev/sync'), env7, mockCtx);
  await Promise.all(waitUntilPromises);
  assert(s7.authCalls === 1, 'Second cycle reuses cached tenant_access_token (0 additional auth subrequests)');

  // -------------------------------------------------------------------------
  // SUITE 8: Simulated End-to-End Auto-Heal Cycle (Table 1 PUT + Table 2 POST/PUT)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST SUITE 8: Simulated End-to-End Auto-Heal Cycle ---');
  resetTokenCache();
  const instCode1 = '7F3D0D9F-C74C-4507-993C-88B7F79DA0BD';
  const { state: s8, env: env8, mockFetch: mf8 } = createMockLarkEnvironment({
    t1Pages: [
      [
        {
          record_id: 'reczz28bLguiEPFR',
          fields: {
            'Request No.': [
              {
                type: 'url',
                text: '202609280009',
                link: 'https://applink.larksuite.com/client/mini_program/open?instanceId=7690423678500376286',
              },
            ],
            'Status': 'Processing',
            'Requester': [{ id: 'ou_requester01', name: 'Mark Wilson' }],
            'Total Cash Advance Amount': 3500,
            'Vendor Bill No.': null,
            'Check No.': null,
            'SourceID': liveCaB64,
          },
        },
      ],
    ],
    // Include 5 empty placeholder rows matching live tbliGywXHe6qMIm6
    t2Pages: [
      [
        { record_id: 'reczz28bLjXIyY9k', fields: { ID: '1', 'Approval Instance Code': null } },
        { record_id: 'reczz28bLjXIzcqF', fields: { ID: '2', 'Approval Instance Code': null } },
        { record_id: 'reczz28bLjXIzK48', fields: { ID: '3', 'Approval Instance Code': null } },
        { record_id: 'reczz28bLjXIyEC1', fields: { ID: '4', 'Approval Instance Code': null } },
        { record_id: 'reczz28bLjXIyelm', fields: { ID: '5', 'Approval Instance Code': null } },
      ],
    ],
    instances: {
      [instCode1]: {
        approval_code: 'D375F005-FCC9-4AA7-8B03-683AA17F4997',
        status: 'PENDING',
        serial_number: '202609280009',
        form: JSON.stringify([
          { id: VENDOR_BILL_WIDGET_ID, name: 'Vendor Bill No.', value: 'VB-CA-2026-101' },
          { id: CHECK_NO_WIDGET_ID, name: 'Check No.', value: 'CHK-CA-5501' },
        ]),
        task_list: [
          {
            node_id: 'c1e48274b814fdce8dc77ddc6be0cd82',
            node_name: 'Team Head (if none, enter requester name)',
            open_id: 'ou_teamhead01',
            start_time: '1759024200000',
            end_time: '1759024260000',
            status: 'APPROVED',
          },
          {
            node_id: '2bc64761cd7fa34d3905a13b982c73f2',
            node_name: 'Department Head',
            open_id: 'ou_depthead01',
            start_time: '1759024261000',
            end_time: '1759024300000',
            status: 'APPROVED',
          },
          {
            node_id: '0d47568655d7427088adc32db11e6dea',
            node_name: 'Accounting Processing',
            open_id: 'ou_acc01',
            start_time: '1759024301000',
            end_time: '1759024400000',
            status: 'APPROVED',
          },
          {
            node_id: 'cc9562b8bb3b689f4051b9f64610f557',
            node_name: 'Treasury Processing',
            open_id: 'ou_treasury01',
            start_time: '1759024401000',
            end_time: '1759024500000',
            status: 'APPROVED',
          },
          {
            node_id: '42fbf264c757382bea8706424f06dd8e',
            node_name: 'For Check Releasing',
            open_id: 'ou_releasing01',
            start_time: '1759024501000',
            end_time: '0',
            status: 'PENDING',
          },
        ],
      },
    },
  });
  globalThis.fetch = mf8;

  // Cycle 1: Initial creation & Table 1 financial auto-heal
  const resCycle1 = await runAutoHealingCycle(env8);
  assert(resCycle1.table1HealedCount === 1, 'Cycle 1 auto-heals Table 1 Vendor Bill No. and Check No.');
  assert(
    s8.t1PutUpdates.length === 1 &&
      s8.t1PutUpdates[0].record_id === 'reczz28bLguiEPFR' &&
      s8.t1PutUpdates[0].fields['Vendor Bill No.'] === 'VB-CA-2026-101' &&
      s8.t1PutUpdates[0].fields['Check No.'] === 'CHK-CA-5501',
    'Table 1 PUT payload contains exact Vendor Bill No. and Check No.'
  );
  assert(resCycle1.healedCount === 1 && s8.t2PostCreates.length === 1, 'Cycle 1 creates 1 new Table 2 row via POST');
  const createdT2 = s8.t2PostCreates[0].fields;
  assert(
    createdT2['Approval Instance Code'] === instCode1 &&
      createdT2['Request No'] === '202609280009' &&
      createdT2['SourceID'] === liveCaB64 &&
      createdT2['Overall Status'] === 'Phase 3: Treasury Processing & Check Release' &&
      createdT2['Task ID'].text === '202609280009' &&
      createdT2['Requester'][0].id === 'ou_requester01' &&
      createdT2['For Check Releasing > 2000 Action'] === 'PENDING',
    'Created Table 2 row contains complete header fields, native Task ID URL, native Requester User, and 8-stage metrics'
  );

  // Cycle 2: No changes -> 0 PUTs to Table 1 or Table 2
  const resCycle2 = await runAutoHealingCycle(env8);
  assert(
    resCycle2.healedCount === 0 &&
      resCycle2.updatedCount === 0 &&
      resCycle2.table1HealedCount === 0 &&
      s8.t1PutUpdates.length === 1 &&
      s8.t2PutUpdates.length === 0,
    'Cycle 2 with unchanged state performs 0 Table 1 PUTs and 0 Table 2 PUTs'
  );

  // Cycle 3: Instance completes (For Check Releasing + Receipt approved, Status -> Approved)
  s8.t1Pages[0][0].fields['Status'] = 'Approved';
  s8.instances[instCode1].status = 'APPROVED';
  s8.instances[instCode1].task_list[4].end_time = '1759024600000';
  s8.instances[instCode1].task_list[4].status = 'APPROVED';
  s8.instances[instCode1].task_list.push({
    node_id: '1750beb4c4c8c6afe329c07dd4ea6028',
    node_name: 'Receipt',
    open_id: 'ou_requester01',
    start_time: '1759024601000',
    end_time: '1759024700000',
    status: 'APPROVED',
  });

  const resCycle3 = await runAutoHealingCycle(env8);
  assert(resCycle3.updatedCount === 1 && s8.t2PutUpdates.length === 1, 'Cycle 3 performs 1 surgical PUT on Table 2');
  const diffPutFields = s8.t2PutUpdates[0].fields;
  assert(
    diffPutFields['Overall Status'] === 'COMPLETED: Cash Advance Released' &&
      diffPutFields['For Check Releasing > 2000 Action'] === 'APPROVED' &&
      diffPutFields['Receipt Action'] === 'APPROVED' &&
      diffPutFields['Request No'] === undefined,
    'Cycle 3 surgical PUT sends only modified stage/status fields'
  );

  // Cycle 4: Settled terminal row is skipped without calling Approval v4 API
  const subrequestsBeforeCycle4 = s8.subrequests;
  const resCycle4 = await runAutoHealingCycle(env8);
  assert(
    resCycle4.skippedTerminalCount === 1 && s8.subrequests - subrequestsBeforeCycle4 === 2,
    'Cycle 4 skips settled terminal row (only 2 Bitable list subrequests, 0 Approval v4 calls)'
  );

  // Cycle 5 & 6: Completed >2000 row whose Approval form itself left optional finance widgets blank
  // is checked once and then cached as exhausted so subsequent cron cycles do not re-fetch it forever
  s8.t1Pages[0][0].fields['Vendor Bill No.'] = null;
  s8.t1Pages[0][0].fields['Check No.'] = null;
  s8.instances[instCode1].form = JSON.stringify([
    { id: VENDOR_BILL_WIDGET_ID, name: 'Vendor Bill No.', value: '' },
    { id: CHECK_NO_WIDGET_ID, name: 'Check No.', value: '' },
  ]);
  const subrequestsBeforeCycle5 = s8.subrequests;
  const resCycle5 = await runAutoHealingCycle(env8);
  assert(
    resCycle5.skippedTerminalCount === 0 && s8.subrequests - subrequestsBeforeCycle5 === 3,
    'Cycle 5 inspects completed >2000 row once when Table 1 finance fields are blank'
  );
  const subrequestsBeforeCycle6 = s8.subrequests;
  const resCycle6 = await runAutoHealingCycle(env8);
  assert(
    resCycle6.skippedTerminalCount === 1 && s8.subrequests - subrequestsBeforeCycle6 === 2,
    'Cycle 6 skips completed >2000 row via exhaustedFinanceHealCache when Approval form also had blank finance widgets'
  );

  // Cycle 7: Verify 3-tier priority ordering: active in-flight row (priority 1) runs before older completed >2000 finance recheck (priority 2)
  resetTokenCache();
  const activeCode = 'ACTIVE-INFLIGHT-002';
  const activeB64 = btoa(`7709539377965240070:${activeCode}:hash:1`);
  s8.t1Pages[0].push({
    record_id: 'recT1_active_2',
    fields: {
      'Request No.': { text: '202609280010', link: 'https://applink.larksuite.com/ca/10' },
      'Status': 'Processing',
      'Requester': [{ id: 'ou_requester02' }],
      'Total Cash Advance Amount': 1500,
      'SourceID': activeB64,
    },
  });
  s8.t2Pages[0].push({
    record_id: 'recT2_active_2',
    fields: {
      'Approval Instance Code': activeCode,
      'Request No': '202609280010',
      'SourceID': activeB64,
      'Overall Status': 'Phase 1: Line & Dept Review',
      'Task ID': { text: '202609280010', link: 'https://applink.larksuite.com/ca/10' },
      'Requester': [{ id: 'ou_requester02' }],
    },
  });
  s8.instances[activeCode] = {
    status: 'PENDING',
    task_list: [
      {
        node_id: 'b42dc2a7ceae426ff6a9f683db746ac2',
        open_id: 'ou_acc_lt2000',
        start_time: '1759025000000',
        end_time: '0',
        status: 'PENDING',
      },
    ],
  };
  const logLenBeforeCycle7 = s8.requestsLog.length;
  await runAutoHealingCycle(env8);
  const cycle7InstanceGets = s8.requestsLog
    .slice(logLenBeforeCycle7)
    .filter((r) => r.url.includes('/open-apis/approval/v4/instances/'))
    .map((r) => r.url.split('/instances/')[1]);
  assert(
    cycle7InstanceGets[0] === activeCode && cycle7InstanceGets[1] === instCode1,
    'Priority 1 active in-flight row is fetched and updated ahead of older Priority 2 completed >2000 finance-recheck row'
  );

  // -------------------------------------------------------------------------
  // SUITE 9: Multi-Page Bitable Pagination (page_size=500 + page_token)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST SUITE 9: Multi-Page Bitable Pagination ---');
  resetTokenCache();
  const b64Page2 = btoa('7709539377965240070:INST-PAGE2-001:hash:1');
  const { state: s9, env: env9, mockFetch: mf9 } = createMockLarkEnvironment({
    t1Pages: [
      [], // Page 1 empty
      [
        {
          record_id: 'recT1_page2',
          fields: {
            'Request No.': { text: '202609280099', link: 'https://applink.larksuite.com/ca/99' },
            'Status': 'Processing',
            'Requester': [{ id: 'ou_page2' }],
            'SourceID': b64Page2,
          },
        },
      ],
    ],
    t2Pages: [
      [], // Page 1 empty
      [
        {
          record_id: 'recT2_page2',
          fields: {
            'Approval Instance Code': 'INST-PAGE2-001',
            'Request No': '202609280099',
            'SourceID': b64Page2,
            'Overall Status': 'Phase 1: Line & Dept Review',
            'Task ID': { text: '202609280099', link: 'https://applink.larksuite.com/ca/99' },
            'Requester': [{ id: 'ou_page2' }],
          },
        },
      ],
    ],
    instances: {
      'INST-PAGE2-001': {
        status: 'PENDING',
        task_list: [
          {
            node_id: 'c1e48274b814fdce8dc77ddc6be0cd82',
            open_id: 'ou_th2',
            start_time: '1759024200000',
            end_time: '0',
            status: 'PENDING',
          },
        ],
      },
    },
  });
  globalThis.fetch = mf9;

  const resPage = await runAutoHealingCycle(env9);
  assert(
    resPage.totalTable1 === 1 &&
      resPage.healedCount === 0 &&
      resPage.updatedCount === 1 &&
      s9.t2PostCreates.length === 0 &&
      s9.t2PutUpdates.length === 1 &&
      s9.t2PutUpdates[0].record_id === 'recT2_page2',
    'Paginates across multiple Table 1 & Table 2 pages and updates Page 2 record in-place without duplicate POST'
  );

  // -------------------------------------------------------------------------
  // SUITE 10: Subrequest Budget Guard (<= 42 Subrequests)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST SUITE 10: Cloudflare Free Tier Subrequest Budget Guard (<= 42) ---');
  resetTokenCache();
  const manyT1 = [];
  const manyInstances = {};
  for (let i = 1; i <= 55; i++) {
    const code = `INST-BULK-${String(i).padStart(3, '0')}`;
    const b64 = btoa(`7709539377965240070:${code}:hash:1`);
    manyT1.push({
      record_id: `recT1_bulk_${i}`,
      fields: {
        'Request No.': { text: `REQ-${i}`, link: `https://applink.larksuite.com/ca/${i}` },
        'Status': 'Processing',
        'Requester': [{ id: `ou_user_${i}` }],
        'SourceID': b64,
      },
    });
    manyInstances[code] = {
      status: 'PENDING',
      task_list: [
        {
          node_id: 'c1e48274b814fdce8dc77ddc6be0cd82',
          open_id: `ou_approver_${i}`,
          start_time: '1759024200000',
          end_time: '0',
          status: 'PENDING',
        },
      ],
    };
  }

  const { state: s10, env: env10, mockFetch: mf10 } = createMockLarkEnvironment({
    t1Pages: [manyT1],
    t2Pages: [[]],
    instances: manyInstances,
  });
  globalThis.fetch = mf10;

  const resBudget = await runAutoHealingCycle(env10);
  assert(
    resBudget.subrequestsUsed === 41 && s10.subrequests === 41 && resBudget.subrequestsUsed < MAX_SUBREQUESTS,
    `Enforces hard subrequest budget guard without orphan 42nd GET (${resBudget.subrequestsUsed}/${MAX_SUBREQUESTS} used across 55 active rows)`
  );
  assert(
    resBudget.healedCount === 19,
    `Processes 19 instance fetches + 19 Table 2 POSTs + 3 setup calls = 41 subrequests (< ${MAX_SUBREQUESTS})`
  );

  // -------------------------------------------------------------------------
  // SUITE 11: Simulated scheduled() Cron & Error Resilience
  // -------------------------------------------------------------------------
  console.log('\n--- TEST SUITE 11: Simulated scheduled() Cron & Error Resilience ---');
  const cronPromises = [];
  const cronCtx = {
    waitUntil(p) {
      cronPromises.push(p);
    },
  };
  const beforeCrons = serviceMetrics.cronsExecuted;
  await worker.scheduled({}, env10, cronCtx);
  await Promise.all(cronPromises);
  assert(
    serviceMetrics.cronsExecuted === beforeCrons + 1 && typeof serviceMetrics.lastCronTime === 'string',
    'worker.scheduled() increments cronsExecuted, records lastCronTime, and runs remaining backlog'
  );

  // Missing LARK_APP_SECRET throws clean error
  resetTokenCache();
  let secretErrCaught = false;
  try {
    await getTenantAccessToken({ LARK_APP_ID: 'cli_aa74f7f23ab8df04', LARK_APP_SECRET: '' });
  } catch (err) {
    secretErrCaught = err.message.includes('Missing LARK_APP_ID or LARK_APP_SECRET');
  }
  assert(secretErrCaught, 'getTenantAccessToken rejects when LARK_APP_SECRET is missing');

  // Auth failure throws clean error
  resetTokenCache();
  const { env: envFail, mockFetch: mfFail } = createMockLarkEnvironment({ failAuth: true });
  globalThis.fetch = mfFail;
  let authFailCaught = false;
  try {
    await getTenantAccessToken(envFail);
  } catch (err) {
    authFailCaught = err.message.includes('Failed to get tenant_access_token');
  }
  assert(authFailCaught, 'getTenantAccessToken throws descriptive error on non-zero Lark auth code');
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`\n======================================================`);
console.log(`Verification Complete: ${passedTests}/${totalTests} Tests Passed`);
console.log(`======================================================`);

if (passedTests !== totalTests) {
  process.exit(1);
}
