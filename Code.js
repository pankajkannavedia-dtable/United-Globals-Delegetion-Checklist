/***********************************************************************************
 * D-TABLE ANALYTICS — DELEGATION ERP
 * Code.gs  —  COMPLETE BACKEND (single file, sectioned)
 *
 *  SECTION 1  Configuration (single source of truth)
 *  SECTION 2  Routing / doGet / include
 *  SECTION 3  Authentication & Session
 *  SECTION 4  Sheet helpers & utilities
 *  SECTION 5  Drive upload utilities
 *  SECTION 6  Delegation CRUD (Master sheet)
 *  SECTION 7  Doer Dashboard actions (reads Master — consolidated)
 *  SECTION 8  Scorecard data
 *  SECTION 9  Doer List CRUD
 *  SECTION 10 Email notification system
 *  SECTION 11 Optional daily reminder trigger (Delegation-only)
 *  SECTION 12 One-time setup + authorisation helpers
 *  SECTION 13 CHECKLIST MODULE   (recurring tasks — 'Checklist' sheet)
 *  SECTION 14 HELP TICKET MODULE (three-step requests — 'Help Ticket' sheet)
 *
 * Everything lives in this one file. Do not add the @OnlyCurrentDoc annotation
 * anywhere in it — that would limit the script to the bound spreadsheet and
 * block DriveApp outright.
 ***********************************************************************************/


/* =================================================================================
 * SECTION 1 — CONFIGURATION
 * Change it here, it changes everywhere. Nothing below hardcodes any of these.
 * ================================================================================= */
var CONFIG = {
  // ---- Storage ----
  SPREADSHEET_ID    : '1SF21dGoRUUQTa1i3P-jrtZwt-6HY1uzwq91GIb_A1ZU',            // leave blank when the script is bound to the sheet.
                                     // Set it to a sheet ID to point this deployment at a
                                     // specific spreadsheet (standalone scripts, other clients).
  DRIVE_FOLDER_ID   : 'https://drive.google.com/drive/folders/1LX_Q84w8gZ6ZAqQ3P2CYw5ciJ9bej8ff?usp=drive_link',            // folder ID (or a pasted folder URL) for attachments,
                                     // voice notes and proof images. Leave blank and the app
                                     // creates UPLOAD_FOLDER_NAME in your Drive automatically.
  UPLOAD_FOLDER_NAME: 'D-Table Analytics Delegation Uploads',

   // ---- Branding ----
  LOGO_URL          : 'https://static.levocdn.com/WEUCB1XF/UGESLLOGO-7470067643559448576.png',
  LOGO_BASE64       : '',
  COMPANY_NAME      : 'UGESL',
  COMPANY_TAGLINE   : 'Delegation ERP',
  PRIMARY_COLOR     : '#0063B6',   // --color-brand

  // ---- Sheets ----
  MASTER_SHEET      : 'Master',
  DOER_SHEET        : 'Doer List',

  // ---- Domain values ----
  LOCATIONS         : ['HO', 'Bhandup'],
  PRIORITIES        : ['Critical', 'High', 'Medium'],
  STATUSES          : ['Pending', 'Shifted', 'Completed', 'Approval Waiting'],
  DEFAULT_LOCATION  : 'HO',
  MAX_REVISIONS     : 1,             // only Revision 1 exists; beyond it the task shifts to a new row

  // ---- Session ----
  SESSION_KEY       : 'session_token',
  SESSION_TTL       : 7200,          // 2 hours, in seconds

  // ---- Features (Section 13 open decisions, resolved) ----
  ENABLE_VOICE_NOTES  : true,         // set false to remove voice notes from the Assign modal
  VOICE_RECORDER_URL  : 'https://roh-t.github.io/recording/recorder.html',
  ENABLE_DAILY_REMINDER: false,       // Delegation-only daily reminder (see SECTION 11)
  SHOW_FOLLOWUP_COUNT : false,        // Column T kept reserved, hidden in UI

  TIMEZONE          : 'Asia/Kolkata',

  // ---- Archiving ----
  ARCHIVE_AFTER_MONTHS   : 12,                 // change this single number to adjust the retention window
  MASTER_ARCHIVE_SHEET   : 'Master Archive',
  CHECKLIST_ARCHIVE_SHEET: 'Checklist Archive'
};

function getAppUrl()  { return ScriptApp.getService().getUrl(); }
function getLogoSrc() { return CONFIG.LOGO_BASE64 ? CONFIG.LOGO_BASE64 : CONFIG.LOGO_URL; }

/* ---- Master sheet column map (0-based) ----
   REV2 (column H) is retained so existing sheets keep their shape, but the
   system now uses a single revision: CONFIG.MAX_REVISIONS = 1. ------------- */
var COL = {
  TIMESTAMP: 0, TASK_ID: 1, ASSIGNED_BY: 2, ASSIGNED_TO: 3, TASK: 4,
  PLANNED: 5, REV1: 6, REV2: 7, DUE: 8, REVISIONS: 9, STATUS: 10, REASON: 11,
  VOICE: 12, DOCS: 13, PROOF: 14, EMAIL: 15, PROOF_REQ: 16, MD_REMARK: 17,
  EA_REMARK: 18, FOLLOWUP: 19, PRIORITY: 20, ACTUAL: 21, LOCATION: 22, DEPARTMENT: 23,
  VOICE_BY: 24, VOICE_AT: 25, VERIFIER: 26
};
var MASTER_COLS = 27;

/* ---- Doer List column map (0-based) ----
   A=Email  B=Name  C=Role  D=Mobile  E=Role1  F=Status  G=Password */
var DCOL = { EMAIL: 0, NAME: 1, ROLE: 2, MOBILE: 3, ROLE1: 4, STATUS: 5, PASSWORD: 6, WEEKLY_OFF: 7 };
var DOER_COLS = 8;

/* ---- Buddy List column map (0-based) ----
   A=ID  B=Original Doer  C=Buddy Doer  D=From Date  E=To Date
   F=Created By  G=Created At  H=Status(Active/Cancelled) */
var BCOL = { ID: 0, ORIGINAL: 1, BUDDY: 2, FROM: 3, TO: 4, CREATED_BY: 5, CREATED_AT: 6, STATUS: 7 };
var BUDDY_COLS = 8;
var BUDDY_SHEET = 'Buddy List';


/* =================================================================================
 * SECTION 2 — ROUTING
 * ================================================================================= */
var PAGES = {
  index       : { file: 'Index',         title: 'Delegation',     access: ['ADMIN', 'TL'] },
  doer        : { file: 'DoerDashboard', title: 'Doer Dashboard', access: ['ADMIN', 'TL', 'DOER'] },
  checklist   : { file: 'Checklist',     title: 'Checklist',      access: ['ADMIN', 'TL', 'DOER'] },
  verification: { file: 'Verification',  title: 'Verification',   access: ['ADMIN', 'TL', 'DOER'] },
  // Hidden from the menu only — the page, the sheet and every SECTION 14
  // function still work. Remove "hidden: true" to bring the tab back.
  helpticket  : { file: 'HelpTicket',    title: 'Help Ticket',    access: ['ADMIN', 'TL', 'DOER'], hidden: true },
  scorecard   : { file: 'Scorecard',     title: 'Scorecard',      access: ['ADMIN', 'TL', 'DOER'] },
  doerlist    : { file: 'DoerList',      title: 'Doer List',      access: ['ADMIN'] }
};

var NAV_KEY = 'nav_page';
var NAV_TTL = 7200;          // keep in step with SESSION_TTL

/** Records which page the user is navigating to. Called from the navbar. */
function setCurrentPage(page) {
  var user = requireUser();
  if (!PAGES[page] || PAGES[page].access.indexOf(user.accessLevel) === -1) {
    page = defaultPageFor(user.accessLevel);
  }
  CacheService.getUserCache().put(NAV_KEY, page, NAV_TTL);
  return { success: true, page: page };
}

function getCurrentPage() {
  try { return CacheService.getUserCache().get(NAV_KEY); } catch (e) { return null; }
}

function clearCurrentPage() {
  try { CacheService.getUserCache().remove(NAV_KEY); } catch (e) {}
}

/** Signs out completely. Called from the navbar so no ?page=logout is needed. */
function signOutServer() {
  clearUserSession();
  clearCurrentPage();
  // Stop auto sign-in straight after a manual sign-out (6 hours or until they sign in again).
  try { CacheService.getUserCache().put(NO_AUTO_KEY, '1', 21600); } catch (e) {}
  return { success: true };
}

function doGet(e) {
  var p = (e && e.parameter) || {};

  if (p.page === 'logout') { signOutServer(); return renderLogin(''); }

  var user = getUserSession();
  if (!user) user = tryAutoLogin();
  if (!user) return renderLogin('');

  var page = getCurrentPage() || defaultPageFor(user.accessLevel);
  if (!PAGES[page] || PAGES[page].access.indexOf(user.accessLevel) === -1) {
    page = defaultPageFor(user.accessLevel);
  }
  CacheService.getUserCache().put(NAV_KEY, page, NAV_TTL);
  return renderPage(page, user);
}

function defaultPageFor(accessLevel) { return accessLevel === 'DOER' ? 'doer' : 'index'; }

function renderLogin(message) {
  var t = HtmlService.createTemplateFromFile('Index');
  t.showLogin   = true;
  t.loginError  = message || '';
  t.user        = null;
  t.accessLevel = '';
  t.page        = 'login';
  t.logoSrc     = getLogoSrc();
  t.cfg         = CONFIG;
  t.appUrl      = getAppUrl();
  return t.evaluate()
    .setTitle(CONFIG.COMPANY_NAME + ' | ' + CONFIG.COMPANY_TAGLINE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function renderPage(page, user) {
  var def = PAGES[page];
  CURRENT_PAGE = page;
  var t = HtmlService.createTemplateFromFile(def.file);
  t.showLogin   = false;
  t.loginError  = '';
  t.user        = user;
  t.accessLevel = user.accessLevel;
  t.page        = page;
  t.logoSrc     = getLogoSrc();
  t.cfg         = CONFIG;
  t.appUrl      = getAppUrl();
  return t.evaluate()
    .setTitle(CONFIG.COMPANY_NAME + ' | ' + def.title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  var t = HtmlService.createTemplateFromFile(filename);
  // Templates with scriptlets need evaluating; plain files (Style.html) do not.
  if (t && typeof t.evaluate === 'function') return t.evaluate().getContent();
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * include() evaluates a fresh template that does NOT inherit the parent's
 * variables, so Navbar.html asks for its own context through this helper.
 * CURRENT_PAGE is set by renderPage() earlier in the same execution.
 */
var CURRENT_PAGE = '';
function getNavContext() {
  var user = getUserSession() || { name: '', role: '', accessLevel: 'DOER' };
  var links = [];
  Object.keys(PAGES).forEach(function (key) {
        if (!PAGES[key].hidden && PAGES[key].access.indexOf(user.accessLevel) !== -1) {
      links.push({ key: key, title: PAGES[key].title, active: (key === CURRENT_PAGE) });
    }
  });
  return {
    user: user, links: links, logo: getLogoSrc(), appUrl: getAppUrl(),
    company: CONFIG.COMPANY_NAME, tagline: CONFIG.COMPANY_TAGLINE,
    initial: (user.name || '?').charAt(0).toUpperCase()
  };
}


/* =================================================================================
 * SECTION 3 — AUTHENTICATION & SESSION
 * ================================================================================= */
function getUserAccessLevel(role, role1) {
  var r1 = (role1 || '').toString().trim().toLowerCase();
  if (r1 === 'admin' || r1 === 'administrator' || r1 === 'md') return 'ADMIN';
  if (r1 === 'tl' || r1 === 'team lead' || r1 === 'teamlead')   return 'TL';
  return 'DOER';
}

/** Loose comparison: case, surrounding space, repeated spaces and dots all ignored. */
function normalizeKey(v) {
  return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
}
function looseName(v) {
  return normalizeKey(v).replace(/[.\s]/g, '');
}

/**
 * Finds a Doer List row by email (column A), independent of casing/spacing.
 */
function findDoerRowByEmail(email) {
  var em = normalizeKey(email);
  var rows = getSheet(CONFIG.DOER_SHEET).getDataRange().getValues();

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (normalizeKey(row[DCOL.EMAIL]) === em) {
      return { row: row, rowNumber: i + 1 };
    }
  }
  return null;
}

function authenticateUser(email, password) {
  try {
    var em = String(email || '').trim();
    var pw = String(password || '');
    if (!em || !pw) return { success: false, message: 'Enter both your email and your password.' };

    // Only @ugesl.com email addresses are allowed to sign in.
    var domain = em.toLowerCase().split('@')[1] || '';
    if (domain !== ALLOWED_DOMAIN) {
      return { success: false,
               message: 'Only official @' + ALLOWED_DOMAIN + ' email addresses can sign in. Please use your company email.' };
    }

    var hit = findDoerRowByEmail(em);
    if (!hit) {
      return { success: false,
               message: 'That email was not found in the Doer List. Check the spelling, or ask your administrator to add you.' };
    }

    var row = hit.row;
    var storedPassword = String(row[DCOL.PASSWORD] || '');
    if (!storedPassword) {
      return { success: false, message: 'No password is set for this account yet. Contact your administrator.' };
    }
    if (storedPassword !== pw) {
      return { success: false, message: 'Incorrect password.' };
    }

    var status = String(row[DCOL.STATUS] || 'Active').trim();
    if (status.toLowerCase() === 'inactive') {
      return { success: false, message: 'This account is inactive. Contact your administrator.' };
    }

    var user = {
      email       : String(row[DCOL.EMAIL] || '').trim(),
      name        : String(row[DCOL.NAME]  || '').trim(),
      role        : String(row[DCOL.ROLE]  || '').trim(),
      role1       : String(row[DCOL.ROLE1] || '').trim(),
      accessLevel : getUserAccessLevel(row[DCOL.ROLE], row[DCOL.ROLE1]),
      timestamp   : new Date().toISOString()
    };
    setUserSession(user);
    CacheService.getUserCache().put(NAV_KEY, defaultPageFor(user.accessLevel), NAV_TTL);
    return { success: true, user: user };
  } catch (err) {
    return { success: false, message: 'Sign-in failed: ' + err.message };
  }
}

/**
 * RUN THIS FROM THE EDITOR when a sign-in is refused.
 * It prints exactly what the app can see in the Doer List — headers, and each
 * row's email, name, access level and status — so you can compare against what
 * is being typed. Nothing is written or changed.
 */
function debugDoerList() {
  var out = [];
  try {
    var sh = getSheet(CONFIG.DOER_SHEET);
    var rows = sh.getDataRange().getValues();
    out.push('Sheet: "' + sh.getName() + '"  ·  ' + (rows.length - 1) + ' data row(s)');
    out.push('Header row: ' + rows[0].join(' | '));
    out.push('Expected: A=Email  B=Name  C=Role  D=Mobile  E=Role1  F=Status  G=Password');
    out.push('---');
    for (var i = 1; i < rows.length && i <= 30; i++) {
      out.push('Row ' + (i + 1) + ':  A="' + rows[i][0] + '"  B="' + rows[i][1] +
               '"  E(Role1)="' + rows[i][DCOL.ROLE1] + '"  F(Status)="' + rows[i][DCOL.STATUS] +
               '"  G(Password set)="' + (rows[i][DCOL.PASSWORD] ? 'yes' : 'NO') +
               '"  → access ' + getUserAccessLevel(rows[i][DCOL.ROLE], rows[i][DCOL.ROLE1]));
    }
  } catch (e) {
    out.push('ERROR: ' + e.message);
  }
  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}


/** RUN ONCE FROM THE EDITOR: adds the "Verifier" header to the live Master sheet. */
function addVerifierColumnOneTime() {
  var sh = getSheet(CONFIG.MASTER_SHEET);
  var col = COL.VERIFIER + 1; // column AA
  if (String(sh.getRange(1, col).getValue()).trim() === '') {
    sh.getRange(1, col).setValue('Verifier')
      .setFontWeight('bold').setBackground(CONFIG.PRIMARY_COLOR).setFontColor('#ffffff');
  }
  return 'Verifier column ready at column ' + col + '.';
}

/** Test a specific pair without using the web app: testLogin('you@co.com','yourPassword') */
function testLogin(email, password) {
  var res = authenticateUser(email, password);
  var msg = res.success
    ? 'OK — signed in as ' + res.user.name + ' with ' + res.user.accessLevel + ' access.'
    : 'REFUSED — ' + res.message;
  Logger.log(msg);
  return msg;
}

// ═══════════════════════════════════════════════════════════════════
// D-TABLE ANALYTICS — Code.gs FIX
// Replace ONLY these 3 functions in SECTION 3 (Authentication & Session).
// Everything else — doGet(), renderLogin(), renderPage(), requireUser(),
// authenticateUser(), etc. — already calls getUserSession()/setUserSession()
// correctly and needs ZERO changes.
// ═══════════════════════════════════════════════════════════════════

/**
 * Cache only. Nothing is written to UserProperties, so a session cannot
 * survive a closed browser or outlive CONFIG.SESSION_TTL.
 */
function setUserSession(userData) {
  try {
    CacheService.getUserCache().put(CONFIG.SESSION_KEY, JSON.stringify(userData), CONFIG.SESSION_TTL);
    return true;
  } catch (error) {
    console.error('Error storing session:', error);
    return false;
  }
}

var _FRESH_USER = null;   // re-read once per request, reused within that request
function getUserSession() {
  try {
    var raw = CacheService.getUserCache().get(CONFIG.SESSION_KEY);
    if (!raw) return null;
    var u = JSON.parse(raw);
    if (u.timestamp && (new Date() - new Date(u.timestamp)) > (CONFIG.SESSION_TTL * 1000)) {
      clearUserSession();
      return null;
    }
    // Always take the latest Role / Role1 / Status from the Doer List,
    // so sheet changes apply immediately without logging out.
    if (_FRESH_USER) return _FRESH_USER;
    var hit = findDoerRowByEmail(u.email);
    if (!hit) { clearUserSession(); return null; }
    var row = hit.row;
    if (String(row[DCOL.STATUS] || 'Active').trim().toLowerCase() === 'inactive') {
      clearUserSession(); return null;
    }
    u.name        = String(row[DCOL.NAME]  || '').trim();
    u.role        = String(row[DCOL.ROLE]  || '').trim();
    u.role1       = String(row[DCOL.ROLE1] || '').trim();
    u.accessLevel = getUserAccessLevel(u.role, u.role1);
    _FRESH_USER = u;
    return u;
  } catch (e) {
    return null;
  }
}

function clearUserSession() {
  try {
    CacheService.getUserCache().remove(CONFIG.SESSION_KEY);
    PropertiesService.getUserProperties().deleteProperty(CONFIG.SESSION_KEY);
    return true;
  } catch (error) {
    console.error('Error clearing session:', error);
    return false;
  }
}
/** Forgot password: user enters email + new password; old password is overwritten. */
function forgotPassword(email, newPassword) {
  var em = String(email || '').trim().toLowerCase();
  var nw = String(newPassword || '').trim();

  if (!em || !nw) return { success: false, message: 'Enter your email and a new password.' };
  if ((em.split('@')[1] || '') !== ALLOWED_DOMAIN) {
    return { success: false, message: 'Only official @' + ALLOWED_DOMAIN + ' email addresses are allowed.' };
  }
  if (nw.length < 6) return { success: false, message: 'New password must be at least 6 characters.' };

  var hit = findDoerRowByEmail(em);
  if (!hit) return { success: false, message: 'That email was not found in the Doer List. Contact your administrator.' };
  if (String(hit.row[DCOL.STATUS] || 'Active').trim().toLowerCase() === 'inactive') {
    return { success: false, message: 'This account is inactive. Contact your administrator.' };
  }

  withLock(function () {
    getSheet(CONFIG.DOER_SHEET).getRange(hit.rowNumber, DCOL.PASSWORD + 1)
      .setNumberFormat('@').setValue(nw);
  });
  return { success: true, message: 'Password updated. Please sign in with your new password.' };
}

/** Forgot password: user enters email + new password; old password is overwritten. */
function forgotPassword(email, newPassword) {
  var em = String(email || '').trim().toLowerCase();
  var nw = String(newPassword || '').trim();

  if (!em || !nw) return { success: false, message: 'Enter your email and a new password.' };
  if ((em.split('@')[1] || '') !== ALLOWED_DOMAIN) {
    return { success: false, message: 'Only official @' + ALLOWED_DOMAIN + ' email addresses are allowed.' };
  }
  if (nw.length < 6) return { success: false, message: 'New password must be at least 6 characters.' };

  var hit = findDoerRowByEmail(em);
  if (!hit) return { success: false, message: 'That email was not found in the Doer List. Contact your administrator.' };
  if (String(hit.row[DCOL.STATUS] || 'Active').trim().toLowerCase() === 'inactive') {
    return { success: false, message: 'This account is inactive. Contact your administrator.' };
  }

  withLock(function () {
    getSheet(CONFIG.DOER_SHEET).getRange(hit.rowNumber, DCOL.PASSWORD + 1)
      .setNumberFormat('@').setValue(nw);
  });
  return { success: true, message: 'Password updated. Please sign in with your new password.' };
}

/** Signed-in user changes their own password. */
function changeMyPassword(currentPassword, newPassword) {
  var user = requireUser();
  var cur = String(currentPassword || '').trim();
  var nw  = String(newPassword || '').trim();
  if (!cur || !nw) throw new Error('Enter your current and new password.');
  if (nw.length < 6) throw new Error('New password must be at least 6 characters.');
  if (cur === nw) throw new Error('New password must be different from the current one.');

  return withLock(function () {
    var hit = findDoerRowByEmail(user.email);
    if (!hit) throw new Error('Your account was not found in the Doer List.');
    if (String(hit.row[DCOL.PASSWORD] || '').trim() !== cur) throw new Error('Current password is incorrect.');
    getSheet(CONFIG.DOER_SHEET).getRange(hit.rowNumber, DCOL.PASSWORD + 1)
      .setNumberFormat('@').setValue(nw);
    return { success: true, message: 'Password changed successfully.' };
  });
}

/** Server-side guard used by EVERY mutating function (fixes the legacy UI-only gating). */
function requireUser() {
  var u = getUserSession();
  if (!u) throw new Error('Your session has expired. Please sign in again.');
  return u;
}
function requireAdmin() {
  var u = requireUser();
  if (u.accessLevel !== 'ADMIN') throw new Error('Only an administrator can do this.');
  return u;
}
/** ADMIN, or the TL/person who originally assigned the task. */
function requireTaskOwner(rowValues) {
  var u = requireUser();
  if (u.accessLevel === 'ADMIN') return u;
  var verifier = (rowValues[COL.VERIFIER] || rowValues[COL.ASSIGNED_BY] || '').toString().trim().toLowerCase();
  if (verifier === u.name.trim().toLowerCase()) return u;
  throw new Error('You can only act on tasks you are the verifier for.');
}


/* =================================================================================
 * SECTION 4 — SHEET HELPERS & UTILITIES
 * ================================================================================= */
/**
 * The one place the database is resolved.
 *  - CONFIG.SPREADSHEET_ID blank  → the sheet this script is bound to (normal setup)
 *  - CONFIG.SPREADSHEET_ID set    → that specific sheet (standalone script, second client,
 *                                   or any code path with no active spreadsheet, such as
 *                                   a time-driven trigger)
 */
function getSS() {
  if (CONFIG.SPREADSHEET_ID) return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('No spreadsheet found. Bind this script to a sheet, or set CONFIG.SPREADSHEET_ID in Code.gs.');
  }
  return ss;
}

function getSheet(name) {
  var sh = getSS().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" was not found in this spreadsheet.');
  return sh;
}

/** Locate the Location column by header text, falling back to index 22 (Column W). */
function getLocationColIndex(sheet) {
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), MASTER_COLS)).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if ((headers[i] || '').toString().trim().toLowerCase() === 'location') return i;
  }
  return COL.LOCATION;
}

/**
 * Sequential Task IDs starting at 1. Reads the highest numeric ID already in
 * the sheet and adds one, so deleting a row never reuses an ID mid-sequence.
 * Always call inside a LockService lock (assignTask and updateTaskDate do).
 */
/**
 * Sequential Task IDs: 1, 2, 3, ...
 * The next number comes from a stored counter, and any number already sitting
 * in the sheet is skipped, so legacy IDs like "Task/647691" or "647693" are
 * ignored rather than continued. Always call inside a LockService lock
 * (assignTask and updateTaskDate do).
 */
function generateTaskId(sheet) {
  var sh    = sheet || getSheet(CONFIG.MASTER_SHEET);
  var props = PropertiesService.getScriptProperties();
  var next  = parseInt(props.getProperty('DELEGATION_ID_COUNTER') || '0', 10);
  if (isNaN(next) || next < 0) next = 0;

  var used = {};
  var last = sh.getLastRow();
  if (last > 1) {
    var ids = sh.getRange(2, COL.TASK_ID + 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) used[String(ids[i][0]).trim()] = true;
  }

  do { next++; } while (used[String(next)]);
  props.setProperty('DELEGATION_ID_COUNTER', String(next));
  return String(next);
}

/** Run once from the editor to renumber future tasks from a given point. */
function resetDelegationIdCounter(startFrom) {
  var from = (startFrom === undefined) ? 0 : Number(startFrom);
  PropertiesService.getScriptProperties().setProperty('DELEGATION_ID_COUNTER', String(from));
  return 'Next delegated task will be numbered ' + (from + 1) + '.';
}

/** Serialises ID generation so two people assigning at once cannot collide. */
function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function fmtDate(d) {
  if (!d) return '';
  if (Object.prototype.toString.call(d) !== '[object Date]') {
    var parsed = new Date(d);
    if (isNaN(parsed.getTime())) return d.toString();
    d = parsed;
  }
  return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
}
function fmtDateTime(d) {
  if (!d) return '';
  if (Object.prototype.toString.call(d) !== '[object Date]') {
    var parsed = new Date(d);
    if (isNaN(parsed.getTime())) return d.toString();
    d = parsed;
  }
  return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm');
}
function prettyDate(d) {
  if (!d) return '';
  var dd = (Object.prototype.toString.call(d) === '[object Date]') ? d : new Date(d);
  if (isNaN(dd.getTime())) return d.toString();
  return Utilities.formatDate(dd, CONFIG.TIMEZONE, 'dd MMM yyyy');
}

/** Monday of the week a date falls in — used for the same-week / different-week rule. */
function mondayOf(dateStr) {
  var d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  var day = d.getDay();                 // 0 = Sun
  var diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return d;
}
function sameWeek(a, b) {
  if (!a || !b) return false;
  return mondayOf(a).getTime() === mondayOf(b).getTime();
}

/** Append a timestamped entry to a remark/reason cell. Entries joined with " || ". */
function appendRemark(existing, text, author) {
  var stamp = '[' + fmtDateTime(new Date()) + '] ' + (author || 'System') + ': ' + text;
  var cur = (existing || '').toString().trim();
  return cur ? (cur + ' || ' + stamp) : stamp;
}

function findTaskRow(taskId) {
  var sh = getSheet(CONFIG.MASTER_SHEET);
  var last = sh.getLastRow();
  if (last < 2) return null;
  var ids = sh.getRange(2, COL.TASK_ID + 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if ((ids[i][0] || '').toString().trim() === (taskId || '').toString().trim()) {
      return { sheet: sh, rowNumber: i + 2,
               values: sh.getRange(i + 2, 1, 1, Math.max(sh.getLastColumn(), MASTER_COLS)).getValues()[0] };
    }
  }
  return null;
}

function lookupDoerEmail(name) {
  var rows = getSheet(CONFIG.DOER_SHEET).getDataRange().getValues();
  var nm = (name || '').toString().trim().toLowerCase();
  for (var i = 1; i < rows.length; i++) {
    if ((rows[i][DCOL.NAME] || '').toString().trim().toLowerCase() === nm) {
      return (rows[i][DCOL.EMAIL] || '').toString().trim();
    }
  }
  return '';
}

/** Everything the client needs on page load, in one round-trip. */
function getBootstrap(location) {
  var user = requireUser();
  return {
    user      : user,
    config    : {
      locations: CONFIG.LOCATIONS, priorities: CONFIG.PRIORITIES, statuses: CONFIG.STATUSES,
      voiceNotes: CONFIG.ENABLE_VOICE_NOTES, voiceRecorderUrl: CONFIG.VOICE_RECORDER_URL,
      showFollowUp: CONFIG.SHOW_FOLLOWUP_COUNT, defaultLocation: CONFIG.DEFAULT_LOCATION
    },
    doers     : getDoers(),
    tasks     : getDelegationTasks(location || CONFIG.DEFAULT_LOCATION)
  };
}


/* =================================================================================
 * SECTION 5 — DRIVE UPLOAD UTILITIES  (all read CONFIG.DRIVE_FOLDER_ID)
 * ================================================================================= */
/**
 * Accepts either a bare folder ID or a pasted Drive URL, and falls back to a
 * folder created in your own Drive if the ID is wrong or inaccessible — so an
 * upload never dies on a mistyped ID.
 */
function extractDriveId(value) {
  var s = (value || '').toString().trim();
  var m = s.match(/[-\w]{25,}/);      // IDs are 25+ chars of [A-Za-z0-9_-]
  return m ? m[0] : '';
}

function getOrCreateFolderByName(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function getUploadFolder() {
  var id = extractDriveId(CONFIG.DRIVE_FOLDER_ID);
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (e) {
      // Wrong ID, deleted folder, or no access under this account — fall through.
    }
  }
  return getOrCreateFolderByName(CONFIG.UPLOAD_FOLDER_NAME);
}

/**
 * RUN THIS ONCE FROM THE EDITOR before using the web app.
 * It touches Drive, Gmail and the spreadsheet so Google shows the consent
 * screen for all three at once. Without it, uploads fail with
 * "Access denied: DriveApp" even though the code is correct.
 */
function authorizeApp() {
  var out = [];
  try {
    var f = getUploadFolder();
    out.push('Drive OK — uploads go to "' + f.getName() + '" (' + f.getUrl() + ')');
  } catch (e) {
    out.push('Drive FAILED — ' + e.message);
  }
  try {
    out.push('Sheets OK — "' + getSS().getName() + '"');
  } catch (e) {
    out.push('Sheets FAILED — ' + e.message);
  }
  try {
    out.push('Gmail OK — ' + MailApp.getRemainingDailyQuota() + ' emails left today');
  } catch (e) {
    out.push('Gmail FAILED — ' + e.message);
  }
  out.push('Web app URL: ' + getAppUrl());
  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

/** Kept as a shorter alias. */
function testDriveAccess() { return authorizeApp(); }

/**
 * If Google will not re-show the consent screen: run revokeAuth() first,
 * then forceAuthPrompt() and accept the prompt.
 */
function revokeAuth() {
  ScriptApp.invalidateAuth();
  Logger.log('Authorisation revoked. Now run forceAuthPrompt() and accept the prompt.');
  return 'Authorisation revoked. Now run forceAuthPrompt().';
}

function forceAuthPrompt() {
  var out = [];
  DriveApp.getRootFolder();                        // Drive scope
  var folder = getUploadFolder();
  out.push('Drive OK — "' + folder.getName() + '" ' + folder.getUrl());
  var ss = getSS();                                // Sheets scope
  out.push('Sheets OK — "' + ss.getName() + '"');
  GmailApp.getAliases();                           // gmail.send scope
  out.push('Gmail OK — ' + MailApp.getRemainingDailyQuota() + ' left today');
  ScriptApp.getService().getUrl();                 // scriptapp scope
  CacheService.getUserCache().put('authping', '1', 60);
  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

/**
 * @param {Object} file {name, mimeType, data} where data is a base64 string (no data: prefix)
 * @return {string} shareable URL
 */
function uploadFileToDrive(file) {
  if (!file || !file.data) return '';
  try {
    return doUpload(file);
  } catch (e) {
    if (/access denied|permission|authoriz/i.test(e.message)) {
      throw new Error('Google has not granted this script access to Drive yet. ' +
        'Open the Apps Script editor, run authorizeApp() once and accept the permission ' +
        'prompt, then deploy a new version of the web app.');
    }
    throw e;
  }
}

function doUpload(file) {
  var bytes = Utilities.base64Decode(file.data);
  var blob  = Utilities.newBlob(bytes, file.mimeType || 'application/octet-stream',
                                (file.name || 'upload') );
  var f = getUploadFolder().createFile(blob);
  try {
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    Logger.log('Link sharing blocked by domain policy: ' + e.message);   // file still saved
  }
  return f.getUrl();
}

function uploadFiles(files) {
  var urls = [];
  (files || []).forEach(function (f) {
    var u = uploadFileToDrive(f);
    if (u) urls.push(u);
  });
  return urls;
}


/* =================================================================================
 * SECTION 6 — DELEGATION CRUD (Master sheet)
 * ================================================================================= */

/** Read tasks, scoped by access level, filtered by location. */
function getDelegationTasks(location) {
  var user = requireUser();
  var sh   = getSheet(CONFIG.MASTER_SHEET);
  var last = sh.getLastRow();
  if (last < 2) return [];

  var locIdx = getLocationColIndex(sh);
  var width  = Math.max(sh.getLastColumn(), MASTER_COLS);
  var rows   = sh.getRange(2, 1, last - 1, width).getValues();
  var loc    = (location || '').toString().trim().toLowerCase();
  var me     = user.name.trim().toLowerCase();
  var holidaySet = loadHolidayDateStrings();
  var buddyMap   = loadActiveBuddyMap();
  var out    = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!(r[COL.TASK_ID] || '').toString().trim()) continue;

    var rowLoc = (r[locIdx] || '').toString().trim().toLowerCase();
    if (loc && loc !== 'all' && rowLoc && rowLoc !== loc) continue;

 var assignedBy = (r[COL.ASSIGNED_BY] || '').toString().trim().toLowerCase();
    var assignedTo = (r[COL.ASSIGNED_TO] || '').toString().trim();
    var verifierLower = (r[COL.VERIFIER] || r[COL.ASSIGNED_BY] || '').toString().trim().toLowerCase();
    var taskDate   = fmtDate(r[COL.REV1]) || fmtDate(r[COL.PLANNED]) || fmtDate(r[COL.DUE]);
    var buddyName  = findBuddyFor(buddyMap, assignedTo, taskDate);
    var iAmBuddy   = buddyName && buddyName.trim().toLowerCase() === me;

    if (user.accessLevel === 'TL'   && assignedBy !== me && verifierLower !== me && assignedTo.toLowerCase() !== me && !iAmBuddy) continue;
    if (user.accessLevel === 'DOER' && assignedTo.toLowerCase() !== me && verifierLower !== me && !iAmBuddy) continue;

    var task = rowToTask(r, locIdx, user, holidaySet);
    task.buddy = buddyName;
    task.actingAsBuddy = !!iAmBuddy;
    out.push(task);
  }
  return out;
}

/** Verification tab: pulls both Delegation and Checklist tasks waiting for approval. */
function getVerificationBootstrap(location) {
  var user = requireUser();
  
  // 1. Delegation Tasks
  var dTasks = getDelegationTasks(location || 'all').filter(function (t) {
    return t.status === 'Approval Waiting' && (user.accessLevel === 'ADMIN' || t.canManage);
  }).map(function(t) { t.source = 'Delegation'; return t; });

  // 2. Checklist Tasks
  var cTasks = getChecklistTasks().filter(function (t) {
    return t.status === 'Approval Waiting' && (user.accessLevel === 'ADMIN' || t.canManage);
  }).map(function(t) { t.source = 'Checklist'; return t; });

  return { user: user, doers: getDoers(), tasks: dTasks.concat(cTasks) };
}
function rowToTask(r, locIdx, user, holidaySet) {
  var planned = fmtDate(r[COL.REV1]) || fmtDate(r[COL.PLANNED]) || fmtDate(r[COL.DUE]);
  var assignedBy = (r[COL.ASSIGNED_BY] || '').toString().trim();
  var verifier   = (r[COL.VERIFIER] || assignedBy).toString().trim();
  var canManage = user.accessLevel === 'ADMIN' ||
                  verifier.toLowerCase() === user.name.trim().toLowerCase();
  var isHoliday = !!(holidaySet && isHolidayDateStr(planned, holidaySet));
  var status = (r[COL.STATUS] || 'Pending').toString().trim();
  if (isHoliday && status === 'Pending') status = 'Holiday';
  return {
    timestamp   : fmtDateTime(r[COL.TIMESTAMP]),
    taskId      : (r[COL.TASK_ID] || '').toString().trim(),
      assignedBy  : assignedBy,
    verifier    : verifier,
    assignedTo  : (r[COL.ASSIGNED_TO] || '').toString().trim(),
    task        : (r[COL.TASK] || '').toString(),
    plannedDate : fmtDate(r[COL.PLANNED]),
    revision1   : fmtDate(r[COL.REV1]),
    dueDate     : fmtDate(r[COL.DUE]),
    currentDate : planned,
    revisions   : Number(r[COL.REVISIONS] || 0),
    isHoliday   : isHoliday,
    status      : status,
    reason      : (r[COL.REASON] || '').toString(),
    voiceNote   : (r[COL.VOICE] || '').toString().trim(),
    voiceId     : extractDriveId(r[COL.VOICE]),
    voiceBy     : (r[COL.VOICE_BY] || '').toString().trim(),
    voiceAt     : fmtDateTime(r[COL.VOICE_AT]),
    documents   : (r[COL.DOCS] || '').toString().split(',').map(function (s) { return s.trim(); }).filter(String),
    proofUrl    : (r[COL.PROOF] || '').toString().trim(),
    email       : (r[COL.EMAIL] || '').toString().trim(),
    proofReq    : ((r[COL.PROOF_REQ] || 'No').toString().trim().toLowerCase() === 'yes') ? 'Yes' : 'No',
    mdRemark    : (r[COL.MD_REMARK] || '').toString(),
    eaRemark    : (r[COL.EA_REMARK] || '').toString(),
    followUp    : Number(r[COL.FOLLOWUP] || 0),
    priority    : (r[COL.PRIORITY] || 'Medium').toString().trim(),
    actualDate  : fmtDateTime(r[COL.ACTUAL]),
    location    : (r[locIdx] || '').toString().trim(),
    department  : (r[COL.DEPARTMENT] || '').toString().trim(),
    canManage   : canManage
  };
}

/**
 * CREATE — Assign a new task.
 * payload: {doerName, priority, task, dueDate, location, proofRequired,
 *           voiceNote:{name,mimeType,data}, attachments:[{...}]}
 */
function assignTask(payload) {
  var user = requireUser();
  if (user.accessLevel === 'DOER') throw new Error('Doers cannot assign tasks.');
  if (!payload.doerName) throw new Error('Choose a doer.');
  if (!payload.task)     throw new Error('Enter a task description.');
  if (!payload.dueDate)  throw new Error('Choose a due date.');

 var sh     = getSheet(CONFIG.MASTER_SHEET);
  var locIdx = getLocationColIndex(sh);
  var email  = lookupDoerEmail(payload.doerName);

  // --- WEEKLY OFF & HOLIDAY CHECK START ---
  var doersList = getDoers();
  var doerObj = doersList.filter(function(d) { return d.name.toLowerCase() === payload.doerName.toLowerCase(); })[0];
  var weeklyOff = doerObj ? doerObj.weeklyOff : 'Sunday';
  var daysMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var parsedDate = new Date(payload.dueDate);
  var dueDayName = daysMap[parsedDate.getDay()];
  var holidaySet = loadHolidayDateStrings();

  if (dueDayName === weeklyOff) throw new Error('Cannot assign task on ' + dueDayName + '. It is ' + payload.doerName + '\'s weekly off.');
  if (holidaySet.indexOf(payload.dueDate) !== -1) throw new Error('Cannot assign task on a Holiday. Check Holiday List.');
  // --- WEEKLY OFF & HOLIDAY CHECK END ---

  var voiceUrl = payload.voiceNote ? uploadFileToDrive(payload.voiceNote) : '';
  var docUrls  = uploadFiles(payload.attachments);

  var taskId = withLock(function () { return generateTaskId(sh); });

  var row = new Array(Math.max(sh.getLastColumn(), MASTER_COLS)).fill('');
   row[COL.TIMESTAMP]   = new Date();
  row[COL.TASK_ID]     = taskId;
  row[COL.ASSIGNED_BY] = user.name;
  row[COL.VERIFIER]    = (payload.verifier && payload.verifier.toString().trim()) ? payload.verifier.toString().trim() : user.name;
  row[COL.ASSIGNED_TO] = payload.doerName;
  row[COL.TASK]        = payload.task;
  row[COL.PLANNED]     = payload.dueDate;
  row[COL.DUE]         = payload.dueDate;
  row[COL.REVISIONS]   = 0;
  row[COL.STATUS]      = 'Pending';
  row[COL.VOICE]       = voiceUrl;
  row[COL.VOICE_BY]    = voiceUrl ? user.name : '';
  row[COL.VOICE_AT]    = voiceUrl ? new Date() : '';
  row[COL.DOCS]        = docUrls.join(', ');
  row[COL.EMAIL]       = email;
  row[COL.PROOF_REQ]   = payload.proofRequired ? 'Yes' : 'No';
  row[COL.FOLLOWUP]    = 0;
  row[COL.PRIORITY]    = payload.priority || 'Medium';
  row[locIdx]          = payload.location || CONFIG.DEFAULT_LOCATION;
  row[COL.DEPARTMENT]  = payload.department || payload.location || CONFIG.DEFAULT_LOCATION;
  sh.appendRow(row);

  // No immediate email here — the doer is notified at 4 PM on the due date
  // itself by sendDailyDueTaskEmails() (see SECTION 11).

  return { success: true, taskId: taskId, message: 'Task ' + taskId + ' assigned to ' + payload.doerName + '.' };
}

/** UPDATE — Reassign to a different doer. Now permission-checked server-side. */
function reassignTask(taskId, newDoerName) {
  var found = findTaskRow(taskId);
  if (!found) throw new Error('Task ' + taskId + ' was not found.');
  var user = requireTaskOwner(found.values);
  if (!newDoerName) throw new Error('Choose the new doer.');

  var oldDoer = (found.values[COL.ASSIGNED_TO] || '').toString();
  var email   = lookupDoerEmail(newDoerName);

  found.sheet.getRange(found.rowNumber, COL.ASSIGNED_TO + 1).setValue(newDoerName);
  found.sheet.getRange(found.rowNumber, COL.EMAIL + 1).setValue(email);
  found.sheet.getRange(found.rowNumber, COL.MD_REMARK + 1)
       .setValue(appendRemark(found.values[COL.MD_REMARK],
                 'Reassigned from ' + oldDoer + ' to ' + newDoerName, user.name));

  // No immediate email — the new doer is notified at 4 PM if the due date is today.

  return { success: true, message: 'Task reassigned to ' + newDoerName + '.' };
}

/** UPDATE — Approve (ADMIN only, server-enforced). */
function approveTask(taskId) {
  var found = findTaskRow(taskId);
  if (!found) throw new Error('Task ' + taskId + ' was not found.');
  var user = requireTaskOwner(found.values);

  found.sheet.getRange(found.rowNumber, COL.STATUS + 1).setValue('Completed');
  found.sheet.getRange(found.rowNumber, COL.MD_REMARK + 1)
       .setValue(appendRemark(found.values[COL.MD_REMARK], 'Approved', user.name));
  if (!found.values[COL.ACTUAL]) {
    found.sheet.getRange(found.rowNumber, COL.ACTUAL + 1).setValue(new Date());
  }

 var email = found.values[COL.EMAIL] || lookupDoerEmail(found.values[COL.ASSIGNED_TO]);
  // if (email) sendApprovalResultEmail(email, found.values, true, '');
  return { success: true, message: 'Task ' + taskId + ' approved.' };
}

/** UPDATE — Disapprove (ADMIN only). Sends the task back to Pending with a reason. */
function disapproveTask(taskId, reason) {
  if (!reason || !reason.toString().trim()) throw new Error('Enter a reason before disapproving.');
  var found = findTaskRow(taskId);
  if (!found) throw new Error('Task ' + taskId + ' was not found.');
  var user = requireTaskOwner(found.values);

  found.sheet.getRange(found.rowNumber, COL.STATUS + 1).setValue('Pending');
  found.sheet.getRange(found.rowNumber, COL.REASON + 1)
       .setValue(appendRemark(found.values[COL.REASON], 'Disapproved — ' + reason, user.name));
  found.sheet.getRange(found.rowNumber, COL.ACTUAL + 1).setValue('');

var email = found.values[COL.EMAIL] || lookupDoerEmail(found.values[COL.ASSIGNED_TO]);
  // if (email) sendApprovalResultEmail(email, found.values, false, reason);
  return { success: true, message: 'Task ' + taskId + ' sent back for rework.' };
}

/** UPDATE — Add MD remark (optionally changing status at the same time). */
function addMDRemark(taskId, remark, newStatus) {
  var found = findTaskRow(taskId);
  if (!found) throw new Error('Task ' + taskId + ' was not found.');
  var user = requireTaskOwner(found.values);
  if (!remark || !remark.toString().trim()) throw new Error('Enter a remark.');

  found.sheet.getRange(found.rowNumber, COL.MD_REMARK + 1)
       .setValue(appendRemark(found.values[COL.MD_REMARK], remark, user.name));
  if (newStatus && CONFIG.STATUSES.indexOf(newStatus) !== -1) {
    found.sheet.getRange(found.rowNumber, COL.STATUS + 1).setValue(newStatus);
  }
  return { success: true, message: 'MD remark added.' };
}

/** UPDATE — Add EA remark. */
function addEARemark(taskId, remark) {
  var found = findTaskRow(taskId);
  if (!found) throw new Error('Task ' + taskId + ' was not found.');
  var user = requireTaskOwner(found.values);
  if (!remark || !remark.toString().trim()) throw new Error('Enter a remark.');

  found.sheet.getRange(found.rowNumber, COL.EA_REMARK + 1)
       .setValue(appendRemark(found.values[COL.EA_REMARK], remark, user.name));
  return { success: true, message: 'EA remark added.' };
}

/** DELETE — Now permission-checked server-side. */
function deleteDelegatedTask(taskId) {
  var found = findTaskRow(taskId);
  if (!found) throw new Error('Task ' + taskId + ' was not found.');
  requireTaskOwner(found.values);
  found.sheet.deleteRow(found.rowNumber);
  return { success: true, message: 'Task ' + taskId + ' deleted.' };
}

/** Manual reminder (bell icon). */
function sendTaskReminder(taskId) {
  var found = findTaskRow(taskId);
  if (!found) throw new Error('Task ' + taskId + ' was not found.');
  requireTaskOwner(found.values);
  var email = found.values[COL.EMAIL] || lookupDoerEmail(found.values[COL.ASSIGNED_TO]);
  if (!email) throw new Error('No email address on file for this doer.');

  sendReminderEmail(email, found.values);
  found.sheet.getRange(found.rowNumber, COL.FOLLOWUP + 1)
       .setValue(Number(found.values[COL.FOLLOWUP] || 0) + 1);
  return { success: true, message: 'Reminder sent to ' + found.values[COL.ASSIGNED_TO] + '.' };
}

/** TEST: run this from the editor with a real Task ID from your Master sheet. */
function testSendReminder() {
  var result = sendTaskReminder('18');   // <-- yahan apni sheet ka koi valid Task ID daalo
  Logger.log(result.message);
  return result.message;
}

function testDirectEmail() {
  var fakeRow = [];
  fakeRow[COL.TASK_ID]  = 'TEST123';
  fakeRow[COL.TASK]     = 'Test task description';
  fakeRow[COL.REV1]     = new Date();
  fakeRow[COL.PLANNED]  = new Date();
  fakeRow[COL.PRIORITY] = 'High';
  fakeRow[COL.STATUS]   = 'Pending';

  sendReminderEmail('radhaverma@dtableanalytics.com', fakeRow);   // <-- apna real email daalo
  Logger.log('Sent — check inbox!');
}
/* =================================================================================
 * SECTION 7 — DOER DASHBOARD ACTIONS
 * Consolidated: reads the Master sheet (the separate DoerDashboard sheet is retired).
 * ================================================================================= */
function getDoerTasks(location) { return getDelegationTasks(location || 'all'); }

/**
 * Doer updates the date on a task.
 *  - same week  → fills Revision 1, then Revision 2, on the same row
 *  - different week → closes this row as "Shifted" and spins off a NEW task row
 *  - after 2 revisions the new date must be next Monday or later
 */
/**
 * Doer updates the date on a task.
 * Now it ALWAYS updates in place. The Task ID will never change.
 */
function updateTaskDate(taskId, newDate, reason, mdRemark) {
  var user  = requireUser();
  var found = findTaskRow(taskId);
  if (!found) throw new Error('Task ' + taskId + ' was not found.');
  if (!newDate) throw new Error('Choose a date.');

  var r = found.values;
  var taskDate = fmtDate(r[COL.REV1]) || fmtDate(r[COL.PLANNED]) || fmtDate(r[COL.DUE]);
  if (user.accessLevel === 'DOER' && !isDoerOrBuddy(user, r[COL.ASSIGNED_TO], taskDate)) {
    throw new Error('This task is not assigned to you.');
  }

  if (!reason || !reason.toString().trim()) {
    throw new Error('Changing the date needs a reason.');
  }

  var revisions = Number(r[COL.REVISIONS] || 0);

  // --- WEEKLY OFF & HOLIDAY CHECK START ---
  var doersList = getDoers();
  var doerObj = doersList.filter(function(d) { return d.name.toLowerCase() === (r[COL.ASSIGNED_TO] || '').toString().trim().toLowerCase(); })[0];
  var weeklyOff = doerObj ? doerObj.weeklyOff : 'Sunday';
  var daysMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var parsedNewDate = new Date(newDate);
  var newDayName = daysMap[parsedNewDate.getDay()];
  var holidaySet = loadHolidayDateStrings();

  if (newDayName === weeklyOff) throw new Error('You cannot shift the task to ' + newDayName + ' (Weekly Off).');
  if (holidaySet.indexOf(newDate) !== -1) throw new Error('You cannot shift the task to a Holiday.');
  // --- WEEKLY OFF & HOLIDAY CHECK END ---

  if (mdRemark && mdRemark.toString().trim()) {
    found.sheet.getRange(found.rowNumber, COL.MD_REMARK + 1)
         .setValue(appendRemark(r[COL.MD_REMARK], mdRemark, user.name));
  }

  // ALWAYS update the existing row. No new IDs will be generated.
  found.sheet.getRange(found.rowNumber, COL.REV1 + 1).setValue(newDate);
  found.sheet.getRange(found.rowNumber, COL.REVISIONS + 1).setValue(revisions + 1);
  found.sheet.getRange(found.rowNumber, COL.STATUS + 1).setValue('Pending');
  found.sheet.getRange(found.rowNumber, COL.REASON + 1)
       .setValue(appendRemark(r[COL.REASON], 'Date moved to ' + newDate + ' — ' + reason, user.name));

  return { success: true, message: 'Date updated to ' + prettyDate(newDate) + '.' };
}

/** Doer marks a task complete → Approval Waiting, notifies the assigner. */
function completeTask(taskId, proofImage, mdRemark) {
  var user  = requireUser();
  var found = findTaskRow(taskId);
  if (!found) throw new Error('Task ' + taskId + ' was not found.');
  var r = found.values;
  var taskDate = fmtDate(r[COL.REV1]) || fmtDate(r[COL.PLANNED]) || fmtDate(r[COL.DUE]);

  if (user.accessLevel === 'DOER' && !isDoerOrBuddy(user, r[COL.ASSIGNED_TO], taskDate)) {
    throw new Error('This task is not assigned to you.');
  }

  var proofRequired = (r[COL.PROOF_REQ] || 'No').toString().trim().toLowerCase() === 'yes';
  var existingProof = (r[COL.PROOF] || '').toString().trim();
  if (proofRequired && !proofImage && !existingProof) {
    throw new Error('This task needs a proof image before it can be completed.');
  }

  if (proofImage) {
    var url = uploadFileToDrive(proofImage);
    found.sheet.getRange(found.rowNumber, COL.PROOF + 1).setValue(url);
  }
  if (mdRemark && mdRemark.toString().trim()) {
    found.sheet.getRange(found.rowNumber, COL.MD_REMARK + 1)
         .setValue(appendRemark(r[COL.MD_REMARK], mdRemark, user.name));
  }

  found.sheet.getRange(found.rowNumber, COL.STATUS + 1).setValue('Approval Waiting');
  found.sheet.getRange(found.rowNumber, COL.ACTUAL + 1).setValue(new Date());

 var assignerEmail = lookupDoerEmail(r[COL.ASSIGNED_BY]);
  // if (assignerEmail) sendApprovalRequestEmail(assignerEmail, r, user.name);

  return { success: true, message: 'Sent for approval.' };
}


/* =================================================================================
 * SECTION 8 — SCORECARD DATA
 * Combines Delegation (Master sheet) + Checklist tasks into one dataset, each
 * row tagged with `source` so the Scorecard page can filter by it.
 * ================================================================================= */
function getScorecardBootstrap(location) {
  var user = requireUser();
  return {
    user  : user,
    doers : getDoers(),
    tasks : getScorecardTasks(location || 'all')
  };
}

function getScorecardTasks(location) {
  var delegation = getDelegationTasks(location || 'all').map(function (t) {
    t.source = 'Delegation';
    return t;
  });
  var checklist = getChecklistTasksForScorecard().map(function (t) {
    t.source = 'Checklist';
    return t;
  });
  return delegation.concat(checklist);
}

/** Reshapes Checklist rows into the same field-shape the Scorecard already expects. */
function getChecklistTasksForScorecard() {
  requireUser();
  var sh = getChecklistSheet();
  var last = sh.getLastRow();
  if (last < 2) return [];

  var rows = sh.getRange(2, 1, last - 1, CHECKLIST_COLS).getValues();
  var out  = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!String(r[CCOL.TASK_ID] || '').trim()) continue;

    var planned = fmtDate(r[CCOL.PLANNED]);
    out.push({
      timestamp   : fmtDateTime(r[CCOL.TIMESTAMP]),
      taskId      : String(r[CCOL.TASK_ID] || '').trim(),
      assignedBy  : String(r[CCOL.ASSIGNED_BY] || '').trim(),
      assignedTo  : String(r[CCOL.DOER] || '').trim(),
      task        : String(r[CCOL.TASK] || '').trim(),
      plannedDate : planned,
      currentDate : planned,
      revision1   : '',
      dueDate     : planned,
      revisions   : 0,
      status      : String(r[CCOL.STATUS] || 'Pending').trim(),
      proofReq    : (String(r[CCOL.PROOF_REQ] || 'No').trim().toLowerCase() === 'yes') ? 'Yes' : 'No',
      priority    : 'Medium',
      actualDate  : fmtDateTime(r[CCOL.ACTUAL])
    });
  }
  return out;
}


/* =================================================================================
 * SECTION 9 — DOER LIST CRUD
 * ================================================================================= */
function getDoers() {
  requireUser();
  var rows = getSheet(CONFIG.DOER_SHEET).getDataRange().getValues();
  var out  = [];
  for (var i = 1; i < rows.length; i++) {
    var email = (rows[i][DCOL.EMAIL] || '').toString().trim();
    var name  = (rows[i][DCOL.NAME]  || '').toString().trim();
    if (!email && !name) continue;
    out.push({
      row     : i + 1,
      email   : email,
      name    : name,
      role    : (rows[i][DCOL.ROLE]   || '').toString().trim(),
      mobile  : (rows[i][DCOL.MOBILE] || '').toString().trim(),
      role1   : (rows[i][DCOL.ROLE1]  || 'Doer').toString().trim(),
      status  : (rows[i][DCOL.STATUS] || 'Active').toString().trim(),
      weeklyOff: (rows[i][DCOL.WEEKLY_OFF] || 'Sunday').toString().trim(),
      access  : getUserAccessLevel(rows[i][DCOL.ROLE], rows[i][DCOL.ROLE1])
    });
  }
  return out;
}

function saveDoer(doer) {
  requireAdmin();
  if (!doer.email || !doer.name) throw new Error('Email and name are both required.');
  var sh   = getSheet(CONFIG.DOER_SHEET);
  var rows = sh.getDataRange().getValues();
  var em   = doer.email.toString().trim().toLowerCase();

  var targetRow = 0;
  if (doer.row) {
    targetRow = Number(doer.row);
  } else {
    for (var i = 1; i < rows.length; i++) {
      if ((rows[i][DCOL.EMAIL] || '').toString().trim().toLowerCase() === em) {
        throw new Error('A doer with that email already exists.');
      }
    }
    targetRow = sh.getLastRow() + 1;
  }

  var existingPassword = '';
  if (doer.row) {
    try { existingPassword = String(sh.getRange(targetRow, DCOL.PASSWORD + 1).getValue() || ''); } catch (e) {}
  }
  var values = [[
    doer.email.toString().trim(),
    doer.name.toString().trim(),
    (doer.role   || '').toString().trim(),
    (doer.mobile || '').toString().trim(),
(doer.role1  || 'Doer').toString().trim(),
    (doer.status || 'Active').toString().trim(),
    (doer.password || '').toString().trim() || existingPassword,
    (doer.weeklyOff || 'Sunday').toString().trim()
  ]];
  sh.getRange(targetRow, 1, 1, DOER_COLS).setValues(values);
  return { success: true, message: doer.row ? 'Doer updated.' : 'Doer added.' };
}
function deleteDoer(rowNumber) {
  requireAdmin();
  var sh = getSheet(CONFIG.DOER_SHEET);
  if (rowNumber < 2 || rowNumber > sh.getLastRow()) throw new Error('That doer no longer exists.');
  sh.deleteRow(Number(rowNumber));
  return { success: true, message: 'Doer removed.' };
}

/**
 * Counts a doer's still-open work, so the UI can offer to shift it before the
 * doer is deleted or set to Inactive. "Open" = Delegation rows not Completed,
 * and Checklist rows not Done/Non-Functional.
 */
function getDoerPendingTaskCounts(doerName) {
  requireAdmin();
  var name = (doerName || '').toString().trim().toLowerCase();
  var counts = { delegation: 0, checklist: 0 };
  if (!name) return counts;

  try {
    var sh = getSheet(CONFIG.MASTER_SHEET);
    var last = sh.getLastRow();
    if (last >= 2) {
      var rows = sh.getRange(2, 1, last - 1, Math.max(sh.getLastColumn(), MASTER_COLS)).getValues();
      rows.forEach(function (r) {
        var assignedTo = (r[COL.ASSIGNED_TO] || '').toString().trim().toLowerCase();
        var status = (r[COL.STATUS] || '').toString().trim();
        if (assignedTo === name && status !== 'Completed') counts.delegation++;
      });
    }
  } catch (e) {}

  try {
    var csh = getChecklistSheet();
    var clast = csh.getLastRow();
    if (clast >= 2) {
      var crows = csh.getRange(2, 1, clast - 1, CHECKLIST_COLS).getValues();
      crows.forEach(function (r) {
        var doer = String(r[CCOL.DOER] || '').trim().toLowerCase();
        var status = String(r[CCOL.STATUS] || '').trim();
        if (doer === name && status !== 'Done' && status !== 'Non-Functional') counts.checklist++;
      });
    }
  } catch (e) {}

  return counts;
}

/**
 * Moves every still-open task (Delegation + Checklist) from oldDoerName to
 * newDoerName. Used when a doer is being deleted or deactivated so their
 * pending work doesn't get orphaned. Completed/Done rows are left untouched
 * as a historical record.
 */
function shiftDoerPendingTasks(oldDoerName, newDoerName) {
  var user = requireAdmin();
  var oldName = (oldDoerName || '').toString().trim();
  var newName = (newDoerName || '').toString().trim();
  if (!oldName || !newName) throw new Error('Choose the doer to move tasks to.');
  if (oldName.toLowerCase() === newName.toLowerCase()) throw new Error('Choose a different doer to take over the work.');

  var newEmail = lookupDoerEmail(newName);
  var moved = { delegation: 0, checklist: 0 };

  // ---- Delegation ----
  try {
    var sh = getSheet(CONFIG.MASTER_SHEET);
    var last = sh.getLastRow();
    if (last >= 2) {
      var width = Math.max(sh.getLastColumn(), MASTER_COLS);
      var rows = sh.getRange(2, 1, last - 1, width).getValues();
      for (var i = 0; i < rows.length; i++) {
        var assignedTo = (rows[i][COL.ASSIGNED_TO] || '').toString().trim().toLowerCase();
        var status = (rows[i][COL.STATUS] || '').toString().trim();
        if (assignedTo === oldName.toLowerCase() && status !== 'Completed') {
          var rn = i + 2;
          sh.getRange(rn, COL.ASSIGNED_TO + 1).setValue(newName);
          sh.getRange(rn, COL.EMAIL + 1).setValue(newEmail);
          sh.getRange(rn, COL.MD_REMARK + 1).setValue(
            appendRemark(rows[i][COL.MD_REMARK], 'Shifted from ' + oldDoerName + ' to ' + newName + ' (doer removed/deactivated)', user.name));
          moved.delegation++;
        }
      }
    }
  } catch (e) {}

  // ---- Checklist ----
  try {
    var csh = getChecklistSheet();
    var clast = csh.getLastRow();
    if (clast >= 2) {
      var crows = csh.getRange(2, 1, clast - 1, CHECKLIST_COLS).getValues();
      for (var j = 0; j < crows.length; j++) {
        var doer = String(crows[j][CCOL.DOER] || '').trim().toLowerCase();
        var cstatus = String(crows[j][CCOL.STATUS] || '').trim();
        if (doer === oldName.toLowerCase() && cstatus !== 'Done' && cstatus !== 'Non-Functional') {
          var crn = j + 2;
          csh.getRange(crn, CCOL.DOER + 1).setValue(newName);
          csh.getRange(crn, CCOL.EMAIL + 1).setValue(newEmail);
          csh.getRange(crn, CCOL.MD_REMARK + 1).setValue(
            appendRemark(crows[j][CCOL.MD_REMARK], 'Shifted from ' + oldDoerName + ' to ' + newName + ' (doer removed/deactivated)', user.name));
          moved.checklist++;
        }
      }
    }
  } catch (e) {}

  return { success: true, moved: moved,
           message: 'Moved ' + moved.delegation + ' delegation task(s) and ' + moved.checklist +
                    ' checklist task(s) from ' + oldDoerName + ' to ' + newName + '.' };
}

/* =================================================================================
 * SECTION 9B — BUDDY SYSTEM (temporary coverage for leave/unavailability)
 * A buddy assignment says: "from date X to date Y, tasks belonging to Original
 * Doer are also visible and actionable by Buddy Doer." Nothing is permanently
 * reassigned — the original owner stays on the row; the buddy just gets
 * temporary access to act on it during the window, for both Delegation and
 * Checklist tasks. Any signed-in user (Admin/TL/Doer) can set this up: a Doer
 * can name a buddy for themselves; Admin/TL can set it up on anyone's behalf.
 * ================================================================================= */
function getBuddySheet() {
  var ss = getSS();
  var sh = ss.getSheetByName(BUDDY_SHEET);
  if (!sh) throw new Error('Sheet "' + BUDDY_SHEET + '" was not found. Run setupBuddySheet() once from the editor.');
  return sh;
}

function setupBuddySheet() {
  var ss = getSS();
  var sh = ss.getSheetByName(BUDDY_SHEET) || ss.insertSheet(BUDDY_SHEET);
  var headers = ['ID', 'Original Doer', 'Buddy Doer', 'From Date', 'To Date', 'Created By', 'Created At', 'Status'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground(CONFIG.PRIMARY_COLOR).setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return 'Buddy List sheet is ready.';
}

/** All buddy assignments visible to the signed-in user: Admin/TL see all, Doer sees only ones naming them. */
function getBuddyAssignments() {
  var user = requireUser();
  var sh = getBuddySheet();
  var last = sh.getLastRow();
  if (last < 2) return [];

  var rows = sh.getRange(2, 1, last - 1, BUDDY_COLS).getValues();
  var me = user.name.trim().toLowerCase();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!String(r[BCOL.ID] || '').trim()) continue;
    var original = String(r[BCOL.ORIGINAL] || '').trim();
    var buddy    = String(r[BCOL.BUDDY] || '').trim();
    if (user.accessLevel === 'DOER' &&
        original.toLowerCase() !== me && buddy.toLowerCase() !== me) continue;

    out.push({
      row: i + 2,
      id: String(r[BCOL.ID]).trim(),
      original: original,
      buddy: buddy,
      fromDate: fmtDate(r[BCOL.FROM]),
      toDate: fmtDate(r[BCOL.TO]),
      createdBy: String(r[BCOL.CREATED_BY] || '').trim(),
      createdAt: fmtDateTime(r[BCOL.CREATED_AT]),
      status: String(r[BCOL.STATUS] || 'Active').trim()
    });
  }
  return out.sort(function (a, b) { return b.fromDate.localeCompare(a.fromDate); });
}

/** Create a buddy coverage window. Doers may only name themselves as the original doer. */
function addBuddyAssignment(originalDoer, buddyDoer, fromDate, toDate) {
  var user = requireUser();
  if (!originalDoer || !buddyDoer) throw new Error('Choose both the doer on leave and their buddy.');
  if (!fromDate || !toDate) throw new Error('Choose the from and to dates.');
  if (new Date(toDate) < new Date(fromDate)) throw new Error('The "to" date must be on or after the "from" date.');
  if (originalDoer.trim().toLowerCase() === buddyDoer.trim().toLowerCase()) {
    throw new Error('The buddy must be a different person.');
  }
  if (user.accessLevel === 'DOER' && originalDoer.trim().toLowerCase() !== user.name.trim().toLowerCase()) {
    throw new Error('You can only set up buddy coverage for your own tasks.');
  }

  var sh = getBuddySheet();
  var id = withLock(function () {
    var props = PropertiesService.getScriptProperties();
    var next = parseInt(props.getProperty('BUDDY_ID_COUNTER') || '0', 10);
    if (isNaN(next) || next < 0) next = 0;
    next++;
    props.setProperty('BUDDY_ID_COUNTER', String(next));
    return 'B' + next;
  });

  sh.appendRow([id, originalDoer.trim(), buddyDoer.trim(), fromDate, toDate,
                user.name, new Date(), 'Active']);

  var buddyEmail = lookupDoerEmail(buddyDoer);
  if (buddyEmail) {
    try {
      var body = '<p style="font-size:14px;color:#2b3245;">You have been set up as a buddy to cover ' +
                 esc11(originalDoer) + '\'s tasks.</p>' +
                 emailRows([['Covering for', originalDoer], ['From', prettyDate(fromDate)], ['To', prettyDate(toDate)]]);
      GmailApp.sendEmail(buddyEmail, '[' + CONFIG.COMPANY_NAME + '] You are covering for ' + originalDoer,
        'You are covering for ' + originalDoer + ' from ' + fromDate + ' to ' + toDate,
        { htmlBody: emailShell('Buddy coverage assigned', CONFIG.PRIMARY_COLOR, body) });
    } catch (e) { /* never block on mail */ }
  }

  return { success: true, message: buddyDoer + ' will cover ' + originalDoer + '\'s tasks from ' +
                     prettyDate(fromDate) + ' to ' + prettyDate(toDate) + '.' };
}

/** Cancel a buddy window early (or remove a mistake). Doer can cancel only their own. */
function cancelBuddyAssignment(row) {
  var user = requireUser();
  var sh = getBuddySheet();
  if (row < 2 || row > sh.getLastRow()) throw new Error('That buddy assignment no longer exists.');
  var values = sh.getRange(row, 1, 1, BUDDY_COLS).getValues()[0];
  var original = String(values[BCOL.ORIGINAL] || '').trim().toLowerCase();
  if (user.accessLevel === 'DOER' && original !== user.name.trim().toLowerCase()) {
    throw new Error('You can only cancel buddy coverage you set up for yourself.');
  }
  sh.getRange(row, BCOL.STATUS + 1).setValue('Cancelled');
  return { success: true, message: 'Buddy coverage cancelled.' };
}

/**
 * Builds { doerNameLower: [{buddy, from, to}, ...] } for every Active buddy
 * window, read once per request and reused for every task row.
 */
function loadActiveBuddyMap() {
  var map = {};
  try {
    var sh = getBuddySheet();
    var last = sh.getLastRow();
    if (last < 2) return map;
    var rows = sh.getRange(2, 1, last - 1, BUDDY_COLS).getValues();
    rows.forEach(function (r) {
      if (String(r[BCOL.STATUS] || '').trim() !== 'Active') return;
      var original = String(r[BCOL.ORIGINAL] || '').trim();
      if (!original) return;
      var key = original.toLowerCase();
      (map[key] = map[key] || []).push({
        buddy: String(r[BCOL.BUDDY] || '').trim(),
        from: fmtDate(r[BCOL.FROM]),
        to: fmtDate(r[BCOL.TO])
      });
    });
  } catch (e) { /* Buddy sheet is optional until setupBuddySheet() runs */ }
  return map;
}

/** Returns the buddy's name if `doerName` has active coverage on `dateStr`, else ''. */
function findBuddyFor(buddyMap, doerName, dateStr) {
  if (!doerName || !dateStr) return '';
  var list = buddyMap[doerName.trim().toLowerCase()];
  if (!list) return '';
  for (var i = 0; i < list.length; i++) {
    if (list[i].from && list[i].to && dateStr >= list[i].from && dateStr <= list[i].to) return list[i].buddy;
  }
  return '';
}

/** True if `user` may act on a task belonging to `doerName` on `dateStr` — either it's their own, or they're the active buddy. */
function isDoerOrBuddy(user, doerName, dateStr, buddyMap) {
  var me = user.name.trim().toLowerCase();
  if ((doerName || '').trim().toLowerCase() === me) return true;
  var buddy = findBuddyFor(buddyMap || loadActiveBuddyMap(), doerName, dateStr);
  return buddy && buddy.trim().toLowerCase() === me;
}


/* =================================================================================
 * SECTION 10 — EMAIL NOTIFICATION SYSTEM
 * Every button links through getAppUrl(). No hardcoded domains, ever.
 * ================================================================================= */
function emailShell(heading, accent, bodyHtml) {
  return '' +
  '<div style="font-family:Segoe UI,Arial,sans-serif;background:#f4f6fb;padding:24px;">' +
    '<div style="max-width:620px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;' +
                'box-shadow:0 6px 24px rgba(28,38,87,.10);">' +
      '<div style="background:' + CONFIG.PRIMARY_COLOR + ';padding:22px 26px;color:#fff;">' +
        '<div style="font-size:19px;font-weight:700;letter-spacing:.4px;">' + CONFIG.COMPANY_NAME + '</div>' +
        '<div style="font-size:12px;opacity:.8;">' + CONFIG.COMPANY_TAGLINE + '</div>' +
      '</div>' +
      '<div style="padding:26px;">' +
        '<h2 style="margin:0 0 16px;color:' + accent + ';font-size:19px;">' + heading + '</h2>' +
        bodyHtml +
        '<div style="text-align:center;margin-top:26px;">' +
          '<a href="' + getAppUrl() + '" style="background:' + CONFIG.PRIMARY_COLOR + ';color:#fff;' +
             'text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:600;display:inline-block;">' +
             'Open Dashboard</a>' +
        '</div>' +
      '</div>' +
      '<div style="background:#f7f8fc;padding:14px;text-align:center;color:#8a90a6;font-size:11px;">' +
        'Automated message from ' + CONFIG.COMPANY_NAME + ' ' + CONFIG.COMPANY_TAGLINE +
      '</div>' +
    '</div>' +
  '</div>';
}

function emailRows(pairs) {
  var html = '<table style="width:100%;border-collapse:collapse;font-size:14px;color:#2b3245;">';
  pairs.forEach(function (p) {
    if (p[1] === '' || p[1] === null || p[1] === undefined) return;
    html += '<tr>' +
      '<td style="padding:8px 10px;background:#f7f8fc;border-radius:6px 0 0 6px;width:38%;color:#6b7192;">' + p[0] + '</td>' +
      '<td style="padding:8px 10px;font-weight:600;">' + p[1] + '</td></tr>' +
      '<tr><td colspan="2" style="height:6px;"></td></tr>';
  });
  return html + '</table>';
}

function sendTaskNotificationEmail(to, t) {
  var links = '';
  if (t.voice) links += '<p style="font-size:13px;">Voice note: <a href="' + t.voice + '">Listen</a></p>';
  if (t.docs && t.docs.length) {
    links += '<p style="font-size:13px;">Attachments: ' + t.docs.map(function (u, i) {
      return '<a href="' + u.trim() + '">File ' + (i + 1) + '</a>';
    }).join(' &nbsp;|&nbsp; ') + '</p>';
  }
  var body = '<p style="font-size:14px;color:#2b3245;">Hi ' + t.doer + ', a new task has been assigned to you.</p>' +
    emailRows([['Task ID', t.taskId], ['Task', t.task], ['Assigned by', t.assignedBy],
               ['Due date', prettyDate(t.dueDate)], ['Priority', t.priority],
               ['Location', t.location], ['Proof required', t.proofReq]]) + links;
  GmailApp.sendEmail(to, '[' + CONFIG.COMPANY_NAME + '] New task assigned — ' + t.taskId,
    'A new task has been assigned to you: ' + t.task, { htmlBody: emailShell('New task assigned', CONFIG.PRIMARY_COLOR, body) });
}

function sendApprovalRequestEmail(to, r, doerName) {
  var body = '<p style="font-size:14px;color:#2b3245;">' + doerName + ' has marked a task complete and it is waiting for your review.</p>' +
    emailRows([['Task ID', r[COL.TASK_ID]], ['Task', r[COL.TASK]], ['Doer', r[COL.ASSIGNED_TO]],
               ['Priority', r[COL.PRIORITY]], ['Submitted', fmtDateTime(new Date())]]);
  GmailApp.sendEmail(to, '[' + CONFIG.COMPANY_NAME + '] Approval needed — ' + r[COL.TASK_ID],
    'A task is waiting for your approval.', { htmlBody: emailShell('Approval needed', '#7C3AED', body) });
}

function sendApprovalResultEmail(to, r, approved, reason) {
  var body = approved
    ? '<p style="font-size:14px;color:#2b3245;">Well done — your task has been approved and closed.</p>' +
      emailRows([['Task ID', r[COL.TASK_ID]], ['Task', r[COL.TASK]], ['Approved on', fmtDateTime(new Date())]])
    : '<p style="font-size:14px;color:#2b3245;">Your task has been sent back for rework.</p>' +
      emailRows([['Task ID', r[COL.TASK_ID]], ['Task', r[COL.TASK]], ['Reason', reason]]);
  GmailApp.sendEmail(to,
    '[' + CONFIG.COMPANY_NAME + '] Task ' + (approved ? 'approved' : 'sent back') + ' — ' + r[COL.TASK_ID],
    approved ? 'Your task was approved.' : 'Your task was sent back: ' + reason,
    { htmlBody: emailShell(approved ? 'Task approved' : 'Task sent back for rework',
                           approved ? '#16A34A' : '#DC2626', body) });
}

function sendReminderEmail(to, r) {
  var planned = fmtDate(r[COL.REV1]) || fmtDate(r[COL.PLANNED]);
  var body = '<p style="font-size:14px;color:#2b3245;">A reminder that this task is still open.</p>' +
    emailRows([['Task ID', r[COL.TASK_ID]], ['Task', r[COL.TASK]],
               ['Due', prettyDate(planned)], ['Priority', r[COL.PRIORITY]], ['Status', r[COL.STATUS]]]);
  GmailApp.sendEmail(to, '[' + CONFIG.COMPANY_NAME + '] Reminder — ' + r[COL.TASK_ID],
    'Reminder: ' + r[COL.TASK], { htmlBody: emailShell('Task reminder', '#D97706', body) });
}


/* =================================================================================
 * SECTION 11 — 4 PM DAILY TASK-DUE EMAILS
 * Tasks are no longer emailed the moment they're assigned. Instead, every day
 * at 4 PM this scans Delegation + Checklist for tasks whose date IS today,
 * groups them per doer, and sends each doer a single consolidated email.
 *
 * SETUP (one-time): run setupDailyTaskEmailTrigger() once from the editor.
 * It creates a time-driven trigger at 4 PM daily. No manual trigger UI needed.
 * ================================================================================= */
function sendDailyDueTaskEmails() {
  var today = fmtDate(new Date());
  var byDoer = {};   // email -> { name, items:[{taskId, task, type}] }

  // ---- Delegation (Master sheet) ----
  try {
    var sh = getSheet(CONFIG.MASTER_SHEET);
    var last = sh.getLastRow();
    if (last >= 2) {
      var rows = sh.getRange(2, 1, last - 1, Math.max(sh.getLastColumn(), MASTER_COLS)).getValues();
     rows.forEach(function (r) {
        var status = (r[COL.STATUS] || '').toString().trim();
        if (status !== 'Pending') return; // Sirf Pending tasks pick karega
        var planned = fmtDate(r[COL.REV1]) || fmtDate(r[COL.PLANNED]) || fmtDate(r[COL.DUE]);
        if (planned !== today) return;
        var email = (r[COL.EMAIL] || '').toString().trim() || lookupDoerEmail(r[COL.ASSIGNED_TO]);
        if (!email) return;
        var doerName = (r[COL.ASSIGNED_TO] || '').toString().trim();
        var entry = byDoer[email] || (byDoer[email] = { name: doerName, items: [] });
        entry.items.push({ taskId: r[COL.TASK_ID], task: (r[COL.TASK] || '').toString(), type: 'Delegation' });
      });
    }
  } catch (e) { /* Master sheet issues never block Checklist emails */ }

  // ---- Checklist ----
  try {
    var csh = getChecklistSheet();
    var clast = csh.getLastRow();
    if (clast >= 2) {
      var crows = csh.getRange(2, 1, clast - 1, CHECKLIST_COLS).getValues();
   crows.forEach(function (r) {
        var status = String(r[CCOL.STATUS] || '').trim();
        if (status !== 'Pending') return; // Sirf Pending tasks pick karega
        var planned = fmtDate(r[CCOL.PLANNED]);
        if (planned !== today) return;
        var email = String(r[CCOL.EMAIL] || '').trim() || lookupDoerEmail(r[CCOL.DOER]);
        if (!email) return;
        var doerName = String(r[CCOL.DOER] || '').trim();
        var entry = byDoer[email] || (byDoer[email] = { name: doerName, items: [] });
        entry.items.push({ taskId: r[CCOL.TASK_ID], task: String(r[CCOL.TASK] || ''), type: 'Checklist' });
      });
    }
  } catch (e) { /* Checklist sheet may not exist yet — skip quietly */ }

  // ---- Skip holidays: no batch email at all on a holiday ----
  var holidaySet = loadHolidayDateStrings();
  if (holidaySet.indexOf(today) !== -1) return;

  // ---- Send one consolidated email per doer ----
  Object.keys(byDoer).forEach(function (email) {
    var info = byDoer[email];
    if (!info.items.length) return;
    var rowsHtml = info.items.map(function (it) {
      return '<li style="margin-bottom:6px;"><strong>[' + esc11(it.type) + ']</strong> ' +
             esc11(it.taskId) + ' — ' + esc11(it.task) + '</li>';
    }).join('');
    var body = '<p style="font-size:14px;color:#2b3245;">Hi ' + esc11(info.name) +
               ', these tasks are due today.</p>' +
               '<ul style="font-size:14px;color:#2b3245;padding-left:18px;">' + rowsHtml + '</ul>';
    GmailApp.sendEmail(email, '[' + CONFIG.COMPANY_NAME + '] Tasks due today',
      'You have tasks due today.', { htmlBody: emailShell('Tasks due today', CONFIG.PRIMARY_COLOR, body) });
  });
}

/** Minimal HTML-escape for the batch email builder above (kept local to avoid clashing with client-side esc()). */
function esc11(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * RUN THIS ONCE FROM THE EDITOR to schedule the 4 PM daily run.
 * Safe to re-run — it removes any previous trigger for this function first,
 * so you never end up with duplicates firing twice a day.
 */
function setupDailyTaskEmailTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyDueTaskEmails') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyDueTaskEmails')
    .timeBased()
    .atHour(16)          // 4 PM, in the script's timezone (Asia/Kolkata)
    .everyDays(1)
    .create();
  return '4 PM daily task-due email trigger is set.';
}


/* =================================================================================
 * SECTION 12 — ONE-TIME SETUP
 * Run setupEverything() once from the editor: it builds every sheet this app uses.
 * ================================================================================= */

/** Creates/verifies Master, Doer List, Checklist, Holiday List and Help Ticket. */
function setupEverything() {
  var out = [];
  out.push(setupSheets());
  out.push(setupChecklistSheet());
  out.push(setupSeriesRulesSheet());
  out.push(setupHelpTicketSheet());
  out.push(setupBuddySheet());
  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}
/* =================================================================================
 * ARCHIVING — moves old Completed/Done rows out of the live sheets so they
 * don't slow the app down, while keeping every record permanently in a
 * separate Archive sheet (nothing is ever deleted).
 * ================================================================================= */
function getOrCreateArchiveSheet(archiveName, sourceSheetName) {
  var ss = getSS();
  var sh = ss.getSheetByName(archiveName);
  if (!sh) {
    sh = ss.insertSheet(archiveName);
    var src = ss.getSheetByName(sourceSheetName);
    if (src && src.getLastColumn() > 0) {
      var headers = src.getRange(1, 1, 1, src.getLastColumn()).getValues();
      sh.getRange(1, 1, 1, headers[0].length).setValues(headers)
        .setFontWeight('bold').setBackground(CONFIG.PRIMARY_COLOR).setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

/** Run once from the editor to make sure both archive sheets exist ahead of time. */
function setupArchiveSheets() {
  getOrCreateArchiveSheet(CONFIG.MASTER_ARCHIVE_SHEET, CONFIG.MASTER_SHEET);
  getOrCreateArchiveSheet(CONFIG.CHECKLIST_ARCHIVE_SHEET, CHECKLIST_CONFIG.SHEET);
  return 'Archive sheets are ready.';
}

/** Moves rows matching statusValue, older than cutoff (by dateColIdx), from source to archive. Returns count moved. */
function archiveSheetRows(sourceSheet, archiveSheet, statusColIdx, statusValue, dateColIdx, cutoff, numCols) {
  var last = sourceSheet.getLastRow();
  if (last < 2) return 0;
  var width = Math.max(sourceSheet.getLastColumn(), numCols);
  var rows = sourceSheet.getRange(2, 1, last - 1, width).getValues();
  var toArchive = [], toDeleteRows = [];
  for (var i = 0; i < rows.length; i++) {
    var status = String(rows[i][statusColIdx] || '').trim();
    var actual = rows[i][dateColIdx];
    if (status === statusValue && actual instanceof Date && actual < cutoff) {
      toArchive.push(rows[i]);
      toDeleteRows.push(i + 2);
    }
  }
  if (!toArchive.length) return 0;
  archiveSheet.getRange(archiveSheet.getLastRow() + 1, 1, toArchive.length, width).setValues(toArchive);
  toDeleteRows.sort(function (a, b) { return b - a; });   // delete bottom-up so row numbers stay valid
  toDeleteRows.forEach(function (r) { sourceSheet.deleteRow(r); });
  return toArchive.length;
}

/** Runs monthly (see setupMonthlyArchiveTrigger). Archives anything Completed/Done past the retention window. */
function archiveOldTasks() {
  var cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - CONFIG.ARCHIVE_AFTER_MONTHS);
  cutoff.setHours(0, 0, 0, 0);

  var movedM = 0, movedC = 0;
  try {
    var mArchive = getOrCreateArchiveSheet(CONFIG.MASTER_ARCHIVE_SHEET, CONFIG.MASTER_SHEET);
    movedM = archiveSheetRows(getSheet(CONFIG.MASTER_SHEET), mArchive, COL.STATUS, 'Completed', COL.ACTUAL, cutoff, MASTER_COLS);
  } catch (e) { Logger.log('Master archiving skipped: ' + e.message); }

  try {
    var cArchive = getOrCreateArchiveSheet(CONFIG.CHECKLIST_ARCHIVE_SHEET, CHECKLIST_CONFIG.SHEET);
    movedC = archiveSheetRows(getChecklistSheet(), cArchive, CCOL.STATUS, 'Done', CCOL.ACTUAL, cutoff, CHECKLIST_COLS);
  } catch (e) { Logger.log('Checklist archiving skipped: ' + e.message); }

  var msg = 'Archived ' + movedM + ' delegation task(s) and ' + movedC + ' checklist task(s).';
  Logger.log(msg);
  return msg;
}

/** Run once from the editor to schedule monthly archiving. */
function setupMonthlyArchiveTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'archiveOldTasks') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('archiveOldTasks')
    .timeBased()
    .onMonthDay(1)
    .atHour(3)
    .create();
  return 'Monthly archiving trigger set (runs 1st of every month at 3 AM).';
}

/** Read-only: every archived task, reshaped to match the Scorecard's expected fields. */
function getArchivedTasksForScorecard() {
  requireUser();
  var out = [];

  try {
    var sh = getSS().getSheetByName(CONFIG.MASTER_ARCHIVE_SHEET);
    if (sh && sh.getLastRow() >= 2) {
      var width = Math.max(sh.getLastColumn(), MASTER_COLS);
      sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues().forEach(function (r) {
        if (!(r[COL.TASK_ID] || '').toString().trim()) return;
        out.push({
          taskId: (r[COL.TASK_ID] || '').toString().trim(),
          assignedTo: (r[COL.ASSIGNED_TO] || '').toString().trim(),
          task: (r[COL.TASK] || '').toString(),
          currentDate: fmtDate(r[COL.REV1]) || fmtDate(r[COL.PLANNED]) || fmtDate(r[COL.DUE]),
          status: (r[COL.STATUS] || 'Completed').toString().trim(),
          priority: (r[COL.PRIORITY] || 'Medium').toString().trim(),
          actualDate: fmtDateTime(r[COL.ACTUAL]),
          timestamp: fmtDateTime(r[COL.TIMESTAMP]),
          source: 'Delegation'
        });
      });
    }
  } catch (e) { /* archive sheet may not exist yet */ }

  try {
    var csh = getSS().getSheetByName(CONFIG.CHECKLIST_ARCHIVE_SHEET);
    if (csh && csh.getLastRow() >= 2) {
      csh.getRange(2, 1, csh.getLastRow() - 1, CHECKLIST_COLS).getValues().forEach(function (r) {
        if (!String(r[CCOL.TASK_ID] || '').trim()) return;
        var planned = fmtDate(r[CCOL.PLANNED]);
        out.push({
          taskId: String(r[CCOL.TASK_ID] || '').trim(),
          assignedTo: String(r[CCOL.DOER] || '').trim(),
          task: String(r[CCOL.TASK] || '').trim(),
          currentDate: planned,
          status: String(r[CCOL.STATUS] || 'Done').trim(),
          priority: 'Medium',
          actualDate: fmtDateTime(r[CCOL.ACTUAL]),
          timestamp: fmtDateTime(r[CCOL.TIMESTAMP]),
          source: 'Checklist'
        });
      });
    }
  } catch (e) { /* archive sheet may not exist yet */ }

  return out;
}
function setupSheets() {
  var ss = getSS();

  var master = ss.getSheetByName(CONFIG.MASTER_SHEET) || ss.insertSheet(CONFIG.MASTER_SHEET);
  var mHeaders = ['Timestamp', 'Task ID', 'Assigned By', 'Assigned To', 'Task Description',
    'Planned Date', 'Revision 1', 'Revision 2', 'Due Date', 'Revisions', 'Status', 'Reason',
    'Voice Note', 'Document', 'Proof of Completion', 'Email ID', 'Proof Required',
    'MD Remark', 'EA Remark', 'Follow Up Count', 'Priority', 'Actual Date', 'Location', 'Department',
    'Voice Note By', 'Voice Note At'];
  master.getRange(1, 1, 1, mHeaders.length).setValues([mHeaders])
        .setFontWeight('bold').setBackground(CONFIG.PRIMARY_COLOR).setFontColor('#ffffff');
  master.setFrozenRows(1);

  var doers = ss.getSheetByName(CONFIG.DOER_SHEET) || ss.insertSheet(CONFIG.DOER_SHEET);
  var dHeaders = ['Email', 'Name', 'Role', 'Mobile', 'Role1', 'Status', 'Password'];
  doers.getRange(1, 1, 1, dHeaders.length).setValues([dHeaders])
       .setFontWeight('bold').setBackground(CONFIG.PRIMARY_COLOR).setFontColor('#ffffff');
  doers.setFrozenRows(1);

  return 'Sheets ready.';
}


/* =================================================================================
 * =================================================================================
 * SECTION 13 — CHECKLIST MODULE
 * Recurring tasks in the 'Checklist' sheet. Uses the same CONFIG, getSS(),
 * requireUser(), withLock(), uploadFileToDrive() and appendRemark() above.
 * Departments from the legacy system are deliberately gone: one spreadsheet,
 * one sheet, the same Doer List and the same three roles.
 * =================================================================================
 * ================================================================================= */

/* ---- Checklist sheet column map (0-based) ---- */
/* ---- Checklist sheet column map (0-based) ---- */
var CCOL = {
  TIMESTAMP: 0, TASK_ID: 1, SERIES_ID: 2, DOER: 3, EMAIL: 4, TASK: 5,
  FREQUENCY: 6, DAY_NAME: 7, PLANNED: 8, ACTUAL: 9, STATUS: 10, PROOF_REQ: 11, PROOF_URL: 12,
  MD_REMARK: 13, EA_REMARK: 14, ASSIGNED_BY: 15, VERIFIER: 16, REQUIRE_VERIFICATION: 17
};
var CHECKLIST_COLS = 18;

var SCOL = {
  SERIES_ID: 0, DOER: 1, EMAIL: 2, TASK: 3, FREQUENCY: 4,
  WEEK_DAYS: 5, MONTH_DAYS: 6, MONTH_ORDINALS: 7, MONTH_DAYS_OF_WEEK: 8,
  START_DATE: 9, END_DATE: 10, PROOF_REQ: 11, ASSIGNED_BY: 12,
  LAST_GENERATED_THROUGH: 13, CREATED_AT: 14, VERIFIER: 15, REQUIRE_VERIFICATION: 16
};
var SERIES_RULES_COLS = 17;
var SERIES_RULES_SHEET = 'Checklist Master';

var CHECKLIST_CONFIG = {
  SHEET          : 'Checklist',
  HOLIDAY_SHEET  : 'Holiday List',
  STATUSES       : ['Pending', 'Done', 'Non-Functional', 'Approval Waiting'],
  FREQUENCIES    : [
    { code: 'D', label: 'Daily' },
    { code: 'W', label: 'Weekly' },
    { code: 'M', label: 'Monthly' },
    { code: 'MW', label: 'Monthly (Day of Week)' },
    { code: 'Q', label: 'Quarterly' },
    { code: 'Y', label: 'Yearly' }
  ],
  SKIP_SUNDAYS   : true,      // daily tasks skip Sundays and holidays
  MAX_OCCURRENCES: 1500       // expanded safety cap per series to support 2026+ ranges
};


/* =================================================================================
 * READ
 * ================================================================================= */

/** Everything the Checklist page needs in one round-trip. */
function getChecklistBootstrap() {
  var user = requireUser();
  return {
    user       : user,
    doers      : getDoers(),
    tasks      : getChecklistTasks(),
    frequencies: CHECKLIST_CONFIG.FREQUENCIES,
    statuses   : CHECKLIST_CONFIG.STATUSES
  };
}

/** All checklist rows visible to the signed-in user. */
function getChecklistTasks() {
  var user = requireUser();
  var sh   = getChecklistSheet();
  var last = sh.getLastRow();
  if (last < 2) return [];

  var rows = sh.getRange(2, 1, last - 1, CHECKLIST_COLS).getValues();
  var me   = user.name.trim().toLowerCase();
  var holidaySet = loadHolidayDateStrings();
  var buddyMap   = loadActiveBuddyMap();
  var out  = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!String(r[CCOL.TASK_ID] || '').trim()) continue;

    var doer = String(r[CCOL.DOER] || '').trim();
    var by   = String(r[CCOL.ASSIGNED_BY] || '').trim().toLowerCase();
    var taskDate  = fmtDate(r[CCOL.PLANNED]);
    var buddyName = findBuddyFor(buddyMap, doer, taskDate);
    var iAmBuddy  = buddyName && buddyName.trim().toLowerCase() === me;

var verifier = String(r[CCOL.VERIFIER] || '').trim().toLowerCase() || by;

    // Doers see only their own rows, ones they verify, or ones they're covering as buddy.
    // TLs see their own plus what they assigned, what they verify, plus what they're covering.
    if (user.accessLevel === 'DOER' && doer.toLowerCase() !== me && verifier !== me && !iAmBuddy) continue;
    if (user.accessLevel === 'TL' && doer.toLowerCase() !== me && by !== me && verifier !== me && !iAmBuddy) continue;

    var task = checklistRowToTask(r, user, holidaySet);
    task.buddy = buddyName;
    task.actingAsBuddy = !!iAmBuddy;
    out.push(task);
  }
  return out;
}

function checklistRowToTask(r, user, holidaySet) {
  var actual = fmtDate(r[CCOL.ACTUAL]);
  var planned = fmtDate(r[CCOL.PLANNED]);
  var isHoliday = !!(holidaySet && isHolidayDateStr(planned, holidaySet));
  var status = String(r[CCOL.STATUS] || '').trim() || (actual ? 'Done' : 'Pending');
  if (isHoliday && status === 'Pending') status = 'Holiday';
  
  var assignedBy = String(r[CCOL.ASSIGNED_BY] || '').trim();
  var verifier = String(r[CCOL.VERIFIER] || assignedBy).trim(); // <-- NEW

  return {
    timestamp  : fmtDateTime(r[CCOL.TIMESTAMP]),
    taskId     : checklistIdStr(r[CCOL.TASK_ID]),
    seriesId   : String(r[CCOL.SERIES_ID] || '').trim(),
    doer       : String(r[CCOL.DOER] || '').trim(),
    email      : String(r[CCOL.EMAIL] || '').trim(),
    task       : String(r[CCOL.TASK] || '').trim(),
    frequency  : String(r[CCOL.FREQUENCY] || '').trim(),
    dayName    : String(r[CCOL.DAY_NAME] || '').trim(),
    plannedDate: planned,
    actualDate : fmtDateTime(r[CCOL.ACTUAL]),
    status     : status,
    isHoliday  : isHoliday,
    proofReq   : (String(r[CCOL.PROOF_REQ] || 'No').trim().toLowerCase() === 'yes') ? 'Yes' : 'No',
    proofUrl   : String(r[CCOL.PROOF_URL] || '').trim(),
    mdRemark   : String(r[CCOL.MD_REMARK] || ''),
    eaRemark   : String(r[CCOL.EA_REMARK] || ''),
        assignedBy : assignedBy,
    verifier   : verifier,
    requiresVerification: String(r[CCOL.REQUIRE_VERIFICATION] || 'Yes').trim().toLowerCase() !== 'no',
    canManage  : user.accessLevel === 'ADMIN' || verifier.toLowerCase() === user.name.trim().toLowerCase()
  };
}

function getChecklistSheet() {
  var ss = getSS();
  var sh = ss.getSheetByName(CHECKLIST_CONFIG.SHEET);
  if (!sh) throw new Error('Sheet "' + CHECKLIST_CONFIG.SHEET +
                           '" was not found. Run setupChecklistSheet() once from the editor.');
  return sh;
}

function findChecklistRow(taskId) {
  var sh = getChecklistSheet();
  var last = sh.getLastRow();
  if (last < 2) return null;
  var ids = sh.getRange(2, CCOL.TASK_ID + 1, last - 1, 1).getValues();
  var want = String(taskId).trim();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === want) {
      return { sheet: sh, rowNumber: i + 2,
               values: sh.getRange(i + 2, 1, 1, CHECKLIST_COLS).getValues()[0] };
    }
  }
  return null;
}


/* =================================================================================
 * CREATE — generate a recurring series
 * ================================================================================= */

/** Number of days in `month` (0-based) of `year` — leap years handled natively by JS. */
function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Adds `monthsToAdd` calendar months to `date`, clamping the day to the last
 * day of the destination month instead of letting JS Date overflow into the
 * following month (e.g. 31 Jan + 1 month becomes 28/29 Feb, not 3 Mar).
 */
function addMonthsClamped(date, monthsToAdd, targetDay) {
  var y = date.getFullYear();
  var m = date.getMonth() + monthsToAdd;
  var newY = y + Math.floor(m / 12);
  var newM = ((m % 12) + 12) % 12;
  var day = Math.min(targetDay, daysInMonth(newY, newM));
  return new Date(newY, newM, day, 0, 0, 0);
}

/**
 * Adds `yearsToAdd` years, keeping the original month and clamping the day
 * so a 29 Feb start date lands on 28 Feb in non-leap years instead of
 * overflowing into March.
 */
function addYearsClamped(date, yearsToAdd, targetMonth, targetDay) {
  var newY = date.getFullYear() + yearsToAdd;
  var day = Math.min(targetDay, daysInMonth(newY, targetMonth));
  return new Date(newY, targetMonth, day, 0, 0, 0);
}

/**
 * Helper to advance any non-daily task to the next working day
 * if it lands on a holiday or the doer's weekly off.
 */
function rollToNextWorkingDay(date, weeklyOff, holidays) {
  var daysMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var cur = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
  var guard = 0;
  while (guard < 30) {
    var dayName = daysMap[cur.getDay()];
    var isOff = (dayName === weeklyOff);
    var isHol = (holidays.indexOf(cur.getTime()) !== -1);
    if (!isOff && !isHol) break;
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return cur;
}

/**
 * Finds the N-th occurrence of a weekday in a given month/year (e.g. 1st Monday, 4th Saturday).
 * nth: 1, 2, 3, 4, or 5 (last)
 */
function getNthWeekdayOfMonth(year, month, targetDayIndex, nth) {
  var date = new Date(year, month, 1, 0, 0, 0);
  var matches = [];
  while (date.getMonth() === month) {
    if (date.getDay() === targetDayIndex) {
      matches.push(new Date(date));
    }
    date.setDate(date.getDate() + 1);
  }
  if (nth === 5 || nth === 'last') {
    return matches[matches.length - 1];
  }
  return matches[nth - 1] || null;
}

function addChecklistSeries(p) {
  var user = requireUser();
  if (user.accessLevel === 'DOER') throw new Error('Only admins and team leads can add checklist tasks.');
  if (!p.doerName)  throw new Error('Choose a doer.');
  if (!p.task)      throw new Error('Enter a task description.');
  if (!p.frequency) throw new Error('Choose a frequency.');
  if (!p.startDate) throw new Error('Choose a start date.');

  var sh       = getChecklistSheet();
  var email    = lookupDoerEmail(p.doerName);
  var freqCode = String(p.frequency).trim().toUpperCase();
  var holidays = loadHolidays();

  var parts = String(p.startDate).split('T')[0].split('-');
  var start = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0);
  var originalDay   = start.getDate();
  var originalMonth = start.getMonth();

  var end;
  if (p.endDate) {
    var ep = String(p.endDate).split('T')[0].split('-');
    end = new Date(Number(ep[0]), Number(ep[1]) - 1, Number(ep[2]), 23, 59, 59);
  } else {
    // No end date given — default to exactly one year from the start date
    // (e.g. start 15 Mar 2026 → default end 14 Mar 2027), not a fixed 31 Dec.
    end = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate() - 1, 23, 59, 59);
  }
  if (end < start) throw new Error('The end date is before the start date.');

  // Never generate more than 12 months ahead in one go — a longer series is
  // continued automatically every month by extendChecklistSeries() below.
  var horizon = new Date(); horizon.setHours(0, 0, 0, 0);
  horizon.setMonth(horizon.getMonth() + 12);
  var genEnd = end < horizon ? end : horizon;

  var doersList = getDoers();
  var doerObj = doersList.filter(function(d) { return d.name.toLowerCase() === p.doerName.toLowerCase(); })[0];
  var weeklyOff = doerObj ? doerObj.weeklyOff : 'Sunday';

  var dates = computeChecklistDates(p, start, start, genEnd, weeklyOff, holidays, originalDay, originalMonth);
  if (!dates.length) throw new Error('That combination produced no working dates within the range. Check frequency and end date.');

   var result = withLock(function () {
    var masterId = nextChecklistMasterId(sh);      // one number per series, e.g. 1111
    var seriesId = 'S/' + masterId;
    var now      = new Date();
    var verifier = (p.verifier && p.verifier.toString().trim()) ? p.verifier.toString().trim() : user.name;
    var occ      = 0;
    var rows     = dates.map(function (d) {
      occ++;
      var row = new Array(CHECKLIST_COLS).fill('');
      row[CCOL.TIMESTAMP]   = now;
      row[CCOL.TASK_ID]     = masterId + '-' + occ;   // 1111-1, 1111-2, 1111-3, ...
      row[CCOL.SERIES_ID]   = seriesId;
      row[CCOL.DOER]        = p.doerName;
      row[CCOL.EMAIL]       = email;
      row[CCOL.TASK]        = p.task;
      row[CCOL.FREQUENCY]   = (freqCode === 'MW' ? 'M' : freqCode.charAt(0));
      row[CCOL.DAY_NAME]    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
      row[CCOL.PLANNED]     = d;
      row[CCOL.STATUS]      = 'Pending';
      row[CCOL.PROOF_REQ]   = p.proofRequired ? 'Yes' : 'No';
      row[CCOL.ASSIGNED_BY] = user.name;
      row[CCOL.VERIFIER]    = verifier;
      row[CCOL.REQUIRE_VERIFICATION] = p.requiresVerification === false ? 'No' : 'Yes';
      return row;
    });
    var startRow = sh.getLastRow() + 1;
    sh.getRange(startRow, CCOL.TASK_ID + 1, rows.length, 1).setNumberFormat('@');
    sh.getRange(startRow, 1, rows.length, CHECKLIST_COLS).setValues(rows);

    // Save the rule so extendChecklistSeries() can pick up where this left off.
    var rulesSheet = getSS().getSheetByName(SERIES_RULES_SHEET);
    if (rulesSheet) {
          rulesSheet.appendRow([
        seriesId, p.doerName, email, p.task, freqCode,
        JSON.stringify(p.weekDays || []), String(p.monthDays || ''),
        JSON.stringify(p.monthOrdinals || []), JSON.stringify(p.monthDaysOfWeek || []),
        start, end, p.proofRequired ? 'Yes' : 'No', user.name,
        dates[dates.length - 1], now, verifier,
        p.requiresVerification === false ? 'No' : 'Yes'
      ]);
    }
    return { count: rows.length, capped: genEnd < end };
  });

  return { success: true, count: result.count,
           message: result.count + ' checklist task' + (result.count === 1 ? '' : 's') +
                    ' created for ' + p.doerName +
                    (result.capped ? ' (generated 12 months ahead — the rest will be added automatically as time goes on).' : '.') };
}

/**
 * Pure date-generation core, shared by addChecklistSeries() (first batch) and
 * extendChecklistSeries() (later batches). originalStart anchors the phase for
 * Quarterly/Yearly (so re-runs land on the same day-of-quarter/year); genStart
 * and genEnd are the window actually being generated this call.
 */
function computeChecklistDates(p, originalStart, genStart, genEnd, weeklyOff, holidays, originalDay, originalMonth) {
  var freqCode = String(p.frequency).trim().toUpperCase();
  var daysMap = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var dates = [];
  var seenMap = {};

  function addDate(d) {
    if (!d || d < genStart || d > genEnd) return;
    var dStr = Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
    if (!seenMap[dStr]) { seenMap[dStr] = true; dates.push(new Date(d)); }
  }

  if (freqCode === 'D') {
    var cur = new Date(genStart); var guard = 0;
    while (cur <= genEnd && dates.length < CHECKLIST_CONFIG.MAX_OCCURRENCES && guard < 5000) {
      guard++;
      var t = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()).getTime();
      var dayName = daysMap[cur.getDay()];
      if (dayName !== weeklyOff && holidays.indexOf(t) === -1) addDate(cur);
      cur.setDate(cur.getDate() + 1);
    }
  } else if (freqCode === 'W') {
    var selectedDays = {};
    (p.weekDays || []).forEach(function(day) { selectedDays[String(day).trim().toLowerCase()] = true; });
    var cur = new Date(genStart); var guard = 0;
    while (cur <= genEnd && dates.length < CHECKLIST_CONFIG.MAX_OCCURRENCES && guard < 5000) {
      guard++;
      var dayName = daysMap[cur.getDay()].toLowerCase();
      if (selectedDays[dayName]) {
        var adjusted = rollToNextWorkingDay(cur, weeklyOff, holidays);
        if (adjusted <= genEnd) addDate(adjusted);
      }
      cur.setDate(cur.getDate() + 1);
    }
  } else if (freqCode === 'M') {
    var targetDays = [originalDay];
    if (p.monthDays && String(p.monthDays).trim()) {
      targetDays = String(p.monthDays).split(',').map(function(s) {
        var n = parseInt(s.trim(), 10); return isNaN(n) ? null : n;
      }).filter(Boolean);
    }
    var curMonth = new Date(genStart.getFullYear(), genStart.getMonth(), 1, 0, 0, 0);
    while (curMonth <= genEnd && dates.length < CHECKLIST_CONFIG.MAX_OCCURRENCES) {
      var y = curMonth.getFullYear(), m = curMonth.getMonth(), maxDays = daysInMonth(y, m);
      targetDays.forEach(function(td) {
        var day = Math.min(td, maxDays);
        var targetDate = new Date(y, m, day, 0, 0, 0);
        if (targetDate >= genStart && targetDate <= genEnd) {
          var adjusted = rollToNextWorkingDay(targetDate, weeklyOff, holidays);
          if (adjusted <= genEnd) addDate(adjusted);
        }
      });
      curMonth.setMonth(curMonth.getMonth() + 1);
    }
  } else if (freqCode === 'MW') {
    var ordinals = (p.monthOrdinals && p.monthOrdinals.length) ? p.monthOrdinals : [1];
    var targetDayNames = (p.monthDaysOfWeek && p.monthDaysOfWeek.length) ? p.monthDaysOfWeek : [p.monthWeekday || 'Monday'];
    var targetDayIndexes = targetDayNames.map(function(dn) {
      return daysMap.map(function(d){ return d.toLowerCase(); }).indexOf(String(dn).trim().toLowerCase());
    }).filter(function(idx) { return idx !== -1; });
    var curMonth = new Date(genStart.getFullYear(), genStart.getMonth(), 1, 0, 0, 0);
    while (curMonth <= genEnd && dates.length < CHECKLIST_CONFIG.MAX_OCCURRENCES) {
      var y = curMonth.getFullYear(), m = curMonth.getMonth();
      ordinals.forEach(function(ord) {
        targetDayIndexes.forEach(function(dayIdx) {
          var d = getNthWeekdayOfMonth(y, m, dayIdx, ord);
          if (d && d >= genStart && d <= genEnd) {
            var adjusted = rollToNextWorkingDay(d, weeklyOff, holidays);
            if (adjusted <= genEnd) addDate(adjusted);
          }
        });
      });
      curMonth.setMonth(curMonth.getMonth() + 1);
    }
  } else if (freqCode === 'Q') {
    // must step from the ORIGINAL start date to keep phase (e.g. always the 15th)
    var cur = new Date(originalStart);
    while (cur <= genEnd) {
      var adjusted = rollToNextWorkingDay(cur, weeklyOff, holidays);
      if (adjusted >= genStart && adjusted <= genEnd) addDate(adjusted);
      cur = addMonthsClamped(cur, 3, originalDay);
    }
  } else if (freqCode === 'Y') {
    var cur = new Date(originalStart);
    while (cur <= genEnd) {
      var adjusted = rollToNextWorkingDay(cur, weeklyOff, holidays);
      if (adjusted >= genStart && adjusted <= genEnd) addDate(adjusted);
      cur = addYearsClamped(cur, 1, originalMonth, originalDay);
    }
  }

  dates.sort(function(a, b) { return a - b; });
  return dates;
}

/**
 * Run automatically every month (see setupMonthlyChecklistExtensionTrigger).
 * For every Series Rules row still short of its own end date, generates the
 * next batch of occurrences — from the day after Last Generated Through up to
 * min(series end, today + 12 months) — and appends them to the Checklist
 * sheet. A series already generated through its end, or through the 12-month
 * horizon, is left untouched until more headroom opens up.
 */
function extendChecklistSeries() {
  var rulesSheet = getSS().getSheetByName(SERIES_RULES_SHEET);
  if (!rulesSheet) return 'Series Rules sheet not found — run setupSeriesRulesSheet() first.';
  var last = rulesSheet.getLastRow();
  if (last < 2) return 'No series rules yet.';

  var rows = rulesSheet.getRange(2, 1, last - 1, SERIES_RULES_COLS).getValues();
  var horizon = new Date(); horizon.setHours(0, 0, 0, 0);
  horizon.setMonth(horizon.getMonth() + 12);
  var holidays = loadHolidays();
  var doersList = getDoers();
  var csh = getChecklistSheet();
  var extendedCount = 0, totalNew = 0;

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var seriesId = String(r[SCOL.SERIES_ID] || '').trim();
    if (!seriesId) continue;

    var through = r[SCOL.LAST_GENERATED_THROUGH] instanceof Date ? r[SCOL.LAST_GENERATED_THROUGH] : null;
    if (!through) continue;
    var seriesEnd = r[SCOL.END_DATE] instanceof Date ? r[SCOL.END_DATE] : null;

    var genStart = new Date(through.getFullYear(), through.getMonth(), through.getDate() + 1, 0, 0, 0);
    var genEnd = (seriesEnd && seriesEnd < horizon) ? seriesEnd : horizon;
    if (genStart > genEnd) continue;   // already fully generated, or not due yet

    var doerName = String(r[SCOL.DOER] || '').trim();
    var doerObj = doersList.filter(function(d) { return d.name.toLowerCase() === doerName.toLowerCase(); })[0];
    var weeklyOff = doerObj ? doerObj.weeklyOff : 'Sunday';
    var originalStart = r[SCOL.START_DATE] instanceof Date ? r[SCOL.START_DATE] : genStart;

    var p = {
      frequency: String(r[SCOL.FREQUENCY] || ''),
      weekDays: safeParseJson(r[SCOL.WEEK_DAYS]),
      monthDays: String(r[SCOL.MONTH_DAYS] || ''),
      monthOrdinals: safeParseJson(r[SCOL.MONTH_ORDINALS]),
      monthDaysOfWeek: safeParseJson(r[SCOL.MONTH_DAYS_OF_WEEK])
    };
    var originalDay = originalStart.getDate();
    var originalMonth = originalStart.getMonth();

    var dates = computeChecklistDates(p, originalStart, genStart, genEnd, weeklyOff, holidays, originalDay, originalMonth);

    if (dates.length) {
           var freqCode = String(r[SCOL.FREQUENCY] || '').toUpperCase();
      var email = String(r[SCOL.EMAIL] || '');
      var task = String(r[SCOL.TASK] || '');
      var proofReq = String(r[SCOL.PROOF_REQ] || 'No');
      var assignedBy = String(r[SCOL.ASSIGNED_BY] || '');
      var verifier = String(r[SCOL.VERIFIER] || assignedBy);
      var requiresVerification = String(r[SCOL.REQUIRE_VERIFICATION] || 'Yes');

      var written = withLock(function () {
        var occInfo   = getSeriesOccurrenceInfo(seriesId, csh);
        var masterId  = occInfo.masterId || nextChecklistMasterId(csh);   // fallback for legacy series
        var occCounter = occInfo.nextOcc;
        var now = new Date();
        var newRows = dates.map(function (d) {
          var row = new Array(CHECKLIST_COLS).fill('');
          row[CCOL.TIMESTAMP]   = now;
          row[CCOL.TASK_ID]     = masterId + '-' + (occCounter++);
          row[CCOL.SERIES_ID]   = seriesId;
          row[CCOL.DOER]        = doerName;
          row[CCOL.EMAIL]       = email;
          row[CCOL.TASK]        = task;
          row[CCOL.FREQUENCY]   = (freqCode === 'MW' ? 'M' : freqCode.charAt(0));
          row[CCOL.DAY_NAME]    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
          row[CCOL.PLANNED]     = d;
          row[CCOL.STATUS]      = 'Pending';
          row[CCOL.PROOF_REQ]   = proofReq;
          row[CCOL.ASSIGNED_BY] = assignedBy;
          row[CCOL.VERIFIER]    = verifier;
          row[CCOL.REQUIRE_VERIFICATION] = requiresVerification;
          return row;
        });
        var startRow = csh.getLastRow() + 1;
        csh.getRange(startRow, CCOL.TASK_ID + 1, newRows.length, 1).setNumberFormat('@');
        csh.getRange(startRow, 1, newRows.length, CHECKLIST_COLS).setValues(newRows);
        return newRows.length;
      });
      totalNew += written;
      extendedCount++;
    }

    var newThrough = dates.length ? dates[dates.length - 1] : genEnd;
    rulesSheet.getRange(i + 2, SCOL.LAST_GENERATED_THROUGH + 1).setValue(newThrough);
  }

  var msg = extendedCount + ' series extended, ' + totalNew + ' new occurrence(s) created.';
  Logger.log(msg);
  return msg;
}

function safeParseJson(v) {
  try { var s = String(v || '').trim(); return s ? JSON.parse(s) : []; } catch (e) { return []; }
}

/** RUN ONCE FROM THE EDITOR to schedule the monthly rolling-generation run. */
function setupMonthlyChecklistExtensionTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'extendChecklistSeries') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('extendChecklistSeries')
    .timeBased()
    .onMonthDay(1)
    .atHour(2)
    .create();
  return 'Monthly checklist-extension trigger set (runs 1st of every month at 2 AM).';
}

/** Sequential checklist IDs from a stored counter, skipping anything already used. */
function nextChecklistId(sheet) {
  var props = PropertiesService.getScriptProperties();
  var next  = parseInt(props.getProperty('CHECKLIST_ID_COUNTER') || '0', 10);
  if (isNaN(next) || next < 0) next = 0;

  var used = {};
  var last = sheet.getLastRow();
  if (last > 1) {
    var ids = sheet.getRange(2, CCOL.TASK_ID + 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) used[String(ids[i][0]).trim()] = true;
  }
  do { next++; } while (used[String(next)]);
  return next;
}

/**
 * Next master id for a NEW series.
 * Rule: if the Checklist sheet has NO data rows at all, start at 1.
 * Otherwise, look at every master id already used (the number before the
 * "-" in an occurrence's Task ID, or the whole Task ID for legacy plain
 * numbers) and return the HIGHEST one found, plus 1 — never a stored
 * counter that could drift out of sync with the actual sheet.
 */
function nextChecklistMasterId(sheet) {
  var last = sheet.getLastRow();

  // No data rows at all (only the header, or a completely empty sheet) → start at 1.
  if (last <= 1) return 1;

  var ids = sheet.getRange(2, CCOL.TASK_ID + 1, last - 1, 1).getValues();
  var highest = 0;
  for (var i = 0; i < ids.length; i++) {
    var v = checklistIdStr(ids[i][0]);
    if (!v) continue;
    var dash = v.indexOf('-');
    var masterPart = dash === -1 ? v : v.slice(0, dash);
    var n = parseInt(masterPart, 10);
    if (!isNaN(n) && n > highest) highest = n;
  }
  return highest + 1;
}

/** For an existing series: finds its master id and the next free occurrence
 *  number, by scanning the "<masterId>-<n>" Task IDs already in Checklist. */
function getSeriesOccurrenceInfo(seriesId, sh) {
  var last = sh.getLastRow();
  var masterId = null, maxOcc = 0;
  if (last >= 2) {
    var data = sh.getRange(2, 1, last - 1, CHECKLIST_COLS).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][CCOL.SERIES_ID]).trim() !== String(seriesId).trim()) continue;
      var tid = checklistIdStr(data[i][CCOL.TASK_ID]);
      var dash = tid.indexOf('-');
      if (dash === -1) continue;   // legacy plain-numbered occurrence, skip
      if (masterId === null) masterId = tid.slice(0, dash);
      var n = parseInt(tid.slice(dash + 1), 10);
      if (!isNaN(n) && n > maxOcc) maxOcc = n;
    }
  }
  return { masterId: masterId, nextOcc: maxOcc + 1 };
}
/** Run once from the editor to renumber future checklist tasks from 1. */
function resetChecklistIdCounter(startFrom) {
  var from = (startFrom === undefined) ? 0 : Number(startFrom);
  PropertiesService.getScriptProperties().setProperty('CHECKLIST_ID_COUNTER', String(from));
  return 'Next checklist task will be numbered ' + (from + 1) + '.';
}

function loadHolidays() {
  var out = [];
  try {
    var sh = getSS().getSheetByName(CHECKLIST_CONFIG.HOLIDAY_SHEET);
    if (!sh || sh.getLastRow() < 2) return out;
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (v) {
      if (v[0] instanceof Date) {
        // Read the date exactly as the sheet displays it (script timezone),
        // then rebuild a clean local midnight so no shifting can occur later.
        var dstr = Utilities.formatDate(v[0], CONFIG.TIMEZONE, 'yyyy-MM-dd');
        var p = dstr.split('-');
        out.push(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getTime());
      }
    });
  } catch (e) { /* holiday sheet is optional */ }
  return out;
}

/** Same set as loadHolidays() but as 'yyyy-MM-dd' strings, for quick lookup on the client and in row-mappers. */
function loadHolidayDateStrings() {
  return loadHolidays().map(function (ms) {
    return Utilities.formatDate(new Date(ms), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  });
}

function isHolidayDateStr(dateStr, holidaySet) {
  if (!dateStr) return false;
  return holidaySet.indexOf(dateStr) !== -1;
}

/* ------------------------------------------------------------------
 * HOLIDAY LIST — CRUD (ADMIN + TL only)
 * ------------------------------------------------------------------ */
function getHolidaySheet() {
  var ss = getSS();
  var sh = ss.getSheetByName(CHECKLIST_CONFIG.HOLIDAY_SHEET);
  if (!sh) throw new Error('Sheet "' + CHECKLIST_CONFIG.HOLIDAY_SHEET +
                           '" was not found. Run setupChecklistSheet() once from the editor.');
  return sh;
}

/** List every holiday, newest/oldest as stored, each tagged with its sheet row for delete. */
function getHolidayList() {
  var user = requireUser();
  if (user.accessLevel === 'DOER') throw new Error('Only admins and team leads can view the holiday list.');

  var sh = getHolidaySheet();
  var last = sh.getLastRow();
  if (last < 2) return [];

  var rows = sh.getRange(2, 1, last - 1, 2).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var d = rows[i][0];
    if (!(d instanceof Date)) continue;
    out.push({
      row: i + 2,
      date: Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd'),
      description: String(rows[i][1] || '').trim()
    });
  }
  return out.sort(function (a, b) { return a.date.localeCompare(b.date); });
}

/** Parses a 'yyyy-MM-dd' string into a local Date at midnight — never through
 *  the UTC-based Date(string) constructor, so no timezone can shift the day. */
function parseLocalDate(dateStr) {
  var parts = String(dateStr).split('T')[0].split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0);
}

/** Add a holiday. Duplicate dates are rejected so the same day is never listed twice. */
function addHoliday(dateStr, description) {
  var user = requireUser();
  if (user.accessLevel === 'DOER') throw new Error('Only admins and team leads can add holidays.');
  if (!dateStr) throw new Error('Choose a date.');

  var cleanDate = String(dateStr).split('T')[0];   // normalise to 'yyyy-MM-dd' only
  var sh = getHolidaySheet();
  var existing = getHolidayList();
  if (existing.some(function (h) { return h.date === cleanDate; })) {
    throw new Error('That date is already marked as a holiday.');
  }

  sh.appendRow([parseLocalDate(cleanDate), (description || '').toString().trim()]);
  return { success: true, message: 'Holiday added for ' + prettyDate(cleanDate) + '.' };
}

/** Delete a holiday by its sheet row (from getHolidayList()). */
function deleteHoliday(rowNumber) {
  var user = requireUser();
  if (user.accessLevel === 'DOER') throw new Error('Only admins and team leads can remove holidays.');

  var sh = getHolidaySheet();
  if (rowNumber < 2 || rowNumber > sh.getLastRow()) throw new Error('That holiday no longer exists.');
  sh.deleteRow(Number(rowNumber));
  return { success: true, message: 'Holiday removed.' };
}


/* =================================================================================
 * UPDATE — complete, non-functional, remarks
 * ================================================================================= */

function completeChecklistTask(taskId, proofFile) {
  var user  = requireUser();
  var found = findChecklistRow(taskId);
  if (!found) throw new Error('Checklist task ' + taskId + ' was not found.');
  var r = found.values;
  var taskDate = fmtDate(r[CCOL.PLANNED]);

  if (user.accessLevel === 'DOER' && !isDoerOrBuddy(user, r[CCOL.DOER], taskDate)) {
    throw new Error('This task is not assigned to you.');
  }
  if (String(r[CCOL.STATUS]).trim() === 'Done') throw new Error('This task is already marked done.');

  var proofRequired = String(r[CCOL.PROOF_REQ] || 'No').trim().toLowerCase() === 'yes';
  if (proofRequired && !proofFile && !String(r[CCOL.PROOF_URL] || '').trim()) {
    throw new Error('This task needs a proof document before it can be completed.');
  }

  if (proofFile) {
    found.sheet.getRange(found.rowNumber, CCOL.PROOF_URL + 1).setValue(uploadFileToDrive(proofFile));
  }
  found.sheet.getRange(found.rowNumber, CCOL.ACTUAL + 1).setValue(new Date());

  // Requires Verification = No hai to seedha 'Done', warna 'Approval Waiting'
  var needsVerification = String(r[CCOL.REQUIRE_VERIFICATION] || 'Yes').trim().toLowerCase() !== 'no';
  found.sheet.getRange(found.rowNumber, CCOL.STATUS + 1).setValue(needsVerification ? 'Approval Waiting' : 'Done');

  return { success: true, message: needsVerification ? 'Sent for approval.' : 'Task marked done.' };
}

function markChecklistNonFunctional(taskId, reason) {
  var user  = requireUser();
  var found = findChecklistRow(taskId);
  if (!found) throw new Error('Checklist task ' + taskId + ' was not found.');
  var r = found.values;
  var taskDate = fmtDate(r[CCOL.PLANNED]);

  if (user.accessLevel === 'DOER' && !isDoerOrBuddy(user, r[CCOL.DOER], taskDate)) {
    throw new Error('This task is not assigned to you.');
  }

  found.sheet.getRange(found.rowNumber, CCOL.ACTUAL + 1).setValue(new Date());
  found.sheet.getRange(found.rowNumber, CCOL.STATUS + 1).setValue('Non-Functional');
  found.sheet.getRange(found.rowNumber, CCOL.MD_REMARK + 1)
       .setValue(appendRemark(r[CCOL.MD_REMARK],
                 'Marked non-functional' + (reason ? ' — ' + reason : ''), user.name));

  return { success: true, message: 'Task ' + taskId + ' marked non-functional.' };
}

/** type: 'md' (HOD) or 'ea' (PC) — same two remark streams as Delegation.
 *  A doer may add remarks on their own task (or one they're covering as buddy);
 *  Admin/TL may add remarks on any task. */
function addChecklistRemark(taskId, remark, type) {
  var user  = requireUser();
  if (!remark || !String(remark).trim()) throw new Error('Enter a remark.');
  var found = findChecklistRow(taskId);
  if (!found) throw new Error('Checklist task ' + taskId + ' was not found.');
  var r = found.values;
  var taskDate = fmtDate(r[CCOL.PLANNED]);

  if (user.accessLevel === 'DOER' && !isDoerOrBuddy(user, r[CCOL.DOER], taskDate)) {
    throw new Error('You can only add remarks on your own tasks.');
  }

  var col = (type === 'ea') ? CCOL.EA_REMARK : CCOL.MD_REMARK;
  found.sheet.getRange(found.rowNumber, col + 1)
       .setValue(appendRemark(found.values[col], remark, user.name));

  return { success: true, message: 'Remark added.' };
}

/** Bulk remark across selected task IDs, written in one batched pass. */
function addBulkChecklistRemarks(taskIds, remark, type) {
  var user = requireUser();
  if (user.accessLevel === 'DOER') throw new Error('Only admins and team leads can add remarks.');
  if (!remark || !String(remark).trim()) throw new Error('Enter a remark.');
  if (!taskIds || !taskIds.length) throw new Error('Select at least one task.');

  var sh   = getChecklistSheet();
  var last = sh.getLastRow();
  if (last < 2) throw new Error('There are no checklist tasks yet.');

  var col   = (type === 'ea') ? CCOL.EA_REMARK : CCOL.MD_REMARK;
  var ids   = sh.getRange(2, CCOL.TASK_ID + 1, last - 1, 1).getValues();
  var cells = sh.getRange(2, col + 1, last - 1, 1).getValues();
  var want  = {};
  taskIds.forEach(function (id) { want[String(id).trim()] = true; });

  var hits = 0;
  for (var i = 0; i < ids.length; i++) {
    if (want[String(ids[i][0]).trim()]) {
      cells[i][0] = appendRemark(cells[i][0], remark, user.name);
      hits++;
    }
  }
  if (!hits) throw new Error('None of the selected tasks were found.');

  sh.getRange(2, col + 1, last - 1, 1).setValues(cells);
  return { success: true, message: 'Remark added to ' + hits + ' task' + (hits === 1 ? '' : 's') + '.' };
}


/* =================================================================================
 * UPDATE / DELETE — whole series
 * ================================================================================= */

/** Reassign or reword every remaining occurrence of a series. */
function updateChecklistSeries(seriesId, newDoerName, newTaskText, futureOnly, requiresVerification) {
  var user = requireUser();
  if (user.accessLevel !== 'ADMIN') throw new Error('You cannot edit or delete. Only users with Role = Admin can make changes.');

  var sh   = getChecklistSheet();
  var last = sh.getLastRow();
  if (last < 2) throw new Error('There are no checklist tasks yet.');

  var rows  = sh.getRange(2, 1, last - 1, CHECKLIST_COLS).getValues();
  var email = newDoerName ? lookupDoerEmail(newDoerName) : '';
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var hits  = 0;
  var newVerifFlag = (requiresVerification === 'Yes' || requiresVerification === 'No') ? requiresVerification : null;

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][CCOL.SERIES_ID]).trim() !== String(seriesId).trim()) continue;
    if (user.accessLevel === 'TL' &&
        String(rows[i][CCOL.ASSIGNED_BY]).trim().toLowerCase() !== user.name.trim().toLowerCase()) {
      throw new Error('You can only edit checklist tasks you created.');
    }
    if (futureOnly) {
      var planned = rows[i][CCOL.PLANNED];
      if (planned instanceof Date && planned < today) continue;
    }
    if (newDoerName)  { rows[i][CCOL.DOER] = newDoerName; rows[i][CCOL.EMAIL] = email; }
    if (newTaskText)  { rows[i][CCOL.TASK] = newTaskText; }
    if (newVerifFlag) { rows[i][CCOL.REQUIRE_VERIFICATION] = newVerifFlag; }
    hits++;
  }
  if (!hits) throw new Error('No matching occurrences found.');

  sh.getRange(2, 1, last - 1, CHECKLIST_COLS).setValues(rows);

  // Keep "Checklist Master" (Series Rules) in sync so future auto-generated
  // occurrences follow the new doer/task/verification setting too.
  try {
    var rulesSheet = getSS().getSheetByName(SERIES_RULES_SHEET);
    if (rulesSheet) {
      var rLast = rulesSheet.getLastRow();
      if (rLast >= 2) {
        var rRows = rulesSheet.getRange(2, 1, rLast - 1, SERIES_RULES_COLS).getValues();
        for (var ri = 0; ri < rRows.length; ri++) {
          if (String(rRows[ri][SCOL.SERIES_ID]).trim() !== String(seriesId).trim()) continue;
          var ruleRowNum = ri + 2;
          if (newDoerName) {
            rulesSheet.getRange(ruleRowNum, SCOL.DOER + 1).setValue(newDoerName);
            rulesSheet.getRange(ruleRowNum, SCOL.EMAIL + 1).setValue(email);
          }
          if (newTaskText)  rulesSheet.getRange(ruleRowNum, SCOL.TASK + 1).setValue(newTaskText);
          if (newVerifFlag) rulesSheet.getRange(ruleRowNum, SCOL.REQUIRE_VERIFICATION + 1).setValue(newVerifFlag);
          break;
        }
      }
    }
  } catch (e) { /* Series Rules sheet is optional/legacy-safe */ }

  return { success: true, message: hits + ' occurrence' + (hits === 1 ? '' : 's') + ' updated.' };
}

function deleteChecklistSeries(seriesId, futureOnly) {
  var user = requireUser();
  if (user.accessLevel !== 'ADMIN') throw new Error('You cannot edit or delete. Only users with Role = Admin can make changes.');

  var sh   = getChecklistSheet();
  var last = sh.getLastRow();
  if (last < 2) throw new Error('There are no checklist tasks yet.');

  var rows   = sh.getRange(2, 1, last - 1, CHECKLIST_COLS).getValues();
  var today  = new Date(); today.setHours(0, 0, 0, 0);
  var toKill = [];

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][CCOL.SERIES_ID]).trim() !== String(seriesId).trim()) continue;
    if (user.accessLevel === 'TL' &&
        String(rows[i][CCOL.ASSIGNED_BY]).trim().toLowerCase() !== user.name.trim().toLowerCase()) {
      throw new Error('You can only delete checklist tasks you created.');
    }
    if (futureOnly) {
      var planned = rows[i][CCOL.PLANNED];
      if (String(rows[i][CCOL.STATUS]).trim() === 'Done') continue;
      if (planned instanceof Date && planned < today) continue;
    }
    toKill.push(i + 2);
  }
  if (!toKill.length) throw new Error('No matching occurrences found.');

  // delete bottom-up, batching consecutive runs
  toKill.sort(function (a, b) { return b - a; });
  var i2 = 0;
  while (i2 < toKill.length) {
    var start = toKill[i2], count = 1;
    while (i2 + 1 < toKill.length && toKill[i2 + 1] === toKill[i2] - 1) { i2++; start = toKill[i2]; count++; }
    sh.deleteRows(start, count);
    i2++;
  }

  // Keep "Checklist Master" (Series Rules) in sync — otherwise
  // extendChecklistSeries() regenerates a series you just deleted.
  try {
    var rulesSheet = getSS().getSheetByName(SERIES_RULES_SHEET);
    if (rulesSheet) {
      var rLast = rulesSheet.getLastRow();
      if (rLast >= 2) {
        var rRows = rulesSheet.getRange(2, 1, rLast - 1, SERIES_RULES_COLS).getValues();
        for (var ri = 0; ri < rRows.length; ri++) {
          if (String(rRows[ri][SCOL.SERIES_ID]).trim() !== String(seriesId).trim()) continue;
          var ruleRowNum = ri + 2;
         rulesSheet.deleteRow(ruleRowNum);
          break;
        }
      }
    }
  } catch (e) { /* Series Rules sheet is optional/legacy-safe */ }

  return { success: true, message: toKill.length + ' occurrence' + (toKill.length === 1 ? '' : 's') + ' deleted.' };
}

/** Bulk delete selected checklist task occurrences (any doers, any series mixed together).
 *  If a series ends up with zero remaining occurrences after this delete, its
 *  Checklist Master (Series Rules) row is removed too, so it never regenerates. */
function deleteChecklistTasksBulk(taskIds) {
  var user = requireUser();
  if (user.accessLevel === 'DOER') throw new Error('Only admins and team leads can delete checklist tasks.');
  if (!taskIds || !taskIds.length) throw new Error('Select at least one task.');

  var sh   = getChecklistSheet();
  var last = sh.getLastRow();
  if (last < 2) throw new Error('There are no checklist tasks yet.');

  var want = {};
  taskIds.forEach(function (id) { want[String(id).trim()] = true; });

  var rows = sh.getRange(2, 1, last - 1, CHECKLIST_COLS).getValues();
  var toKill = [];
  var affectedSeries = {};

  for (var i = 0; i < rows.length; i++) {
    var rowTaskId = String(rows[i][CCOL.TASK_ID] || '').trim();
    if (!want[rowTaskId]) continue;
    if (user.accessLevel === 'TL' &&
        String(rows[i][CCOL.ASSIGNED_BY]).trim().toLowerCase() !== user.name.trim().toLowerCase()) {
      throw new Error('You can only delete checklist tasks you created.');
    }
    toKill.push(i + 2);
    var sid = String(rows[i][CCOL.SERIES_ID] || '').trim();
    if (sid) affectedSeries[sid] = true;
  }
  if (!toKill.length) throw new Error('None of the selected tasks were found.');

  // delete bottom-up, batching consecutive runs
  toKill.sort(function (a, b) { return b - a; });
  var i2 = 0;
  while (i2 < toKill.length) {
    var start = toKill[i2], count = 1;
    while (i2 + 1 < toKill.length && toKill[i2 + 1] === toKill[i2] - 1) { i2++; start = toKill[i2]; count++; }
    sh.deleteRows(start, count);
    i2++;
  }

  // For any series that now has zero remaining occurrences, remove its
  // Checklist Master (Series Rules) row so it never regenerates.
  try {
    var remainingLast = sh.getLastRow();
    var remainingSeriesIds = {};
    if (remainingLast >= 2) {
      var remainingIds = sh.getRange(2, CCOL.SERIES_ID + 1, remainingLast - 1, 1).getValues();
      remainingIds.forEach(function (r) {
        var sid = String(r[0] || '').trim();
        if (sid) remainingSeriesIds[sid] = true;
      });
    }
    var rulesSheet = getSS().getSheetByName(SERIES_RULES_SHEET);
    if (rulesSheet) {
      Object.keys(affectedSeries).forEach(function (sid) {
        if (remainingSeriesIds[sid]) return;   // series still has occurrences, leave its rule alone
        var rLast = rulesSheet.getLastRow();
        if (rLast < 2) return;
        var rRows = rulesSheet.getRange(2, 1, rLast - 1, SERIES_RULES_COLS).getValues();
        for (var ri = rRows.length - 1; ri >= 0; ri--) {
          if (String(rRows[ri][SCOL.SERIES_ID]).trim() === sid) {
            rulesSheet.deleteRow(ri + 2);
            break;
          }
        }
      });
    }
  } catch (e) { /* Series Rules sheet is optional/legacy-safe */ }

  return { success: true, message: toKill.length + ' task' + (toKill.length === 1 ? '' : 's') + ' deleted.' };
}


/** Distinct series for the Edit/Delete picker — reads Checklist Master
 *  (Series Rules) directly instead of re-scanning every Checklist row. */
function getChecklistSeries() {
  var user = requireUser();
  var rsh = getSS().getSheetByName(SERIES_RULES_SHEET);
  if (!rsh) return [];
  var last = rsh.getLastRow();
  if (last < 2) return [];

  var rows = rsh.getRange(2, 1, last - 1, SERIES_RULES_COLS).getValues();
  var me = user.name.trim().toLowerCase();
  var out = [];
  rows.forEach(function (r) {
    var seriesId = String(r[SCOL.SERIES_ID] || '').trim();
    if (!seriesId) return;
    var doer = String(r[SCOL.DOER] || '').trim();
    var assignedBy = String(r[SCOL.ASSIGNED_BY] || '').trim();
    var verifier = String(r[SCOL.VERIFIER] || assignedBy).trim();
    var canManage = user.accessLevel === 'ADMIN' || verifier.toLowerCase() === me;
    if (user.accessLevel === 'TL' && assignedBy.toLowerCase() !== me && verifier.toLowerCase() !== me) return;
    if (!canManage) return;
    out.push({
      seriesId: seriesId,
      doer: doer,
      task: String(r[SCOL.TASK] || '').trim(),
      frequency: String(r[SCOL.FREQUENCY] || '').trim(),
      assignedBy: assignedBy,
      canManage: canManage,
      requiresVerification: String(r[SCOL.REQUIRE_VERIFICATION] || 'Yes').trim().toLowerCase() !== 'no'
    });
  });
  return out.sort(function (a, b) { return a.doer.localeCompare(b.doer) || a.task.localeCompare(b.task); });
}

/** RUN ONCE FROM THE EDITOR: adds "Requires Verification" column to Checklist + Checklist Master. */
function addRequireVerificationColumnsOneTime() {
  var csh = getChecklistSheet();
  if (String(csh.getRange(1, CHECKLIST_COLS).getValue()).trim() === '') {
    csh.getRange(1, CHECKLIST_COLS).setValue('Requires Verification')
       .setFontWeight('bold').setBackground(CONFIG.PRIMARY_COLOR).setFontColor('#ffffff');
  }
  var rsh = getSS().getSheetByName(SERIES_RULES_SHEET);
  if (rsh && String(rsh.getRange(1, SERIES_RULES_COLS).getValue()).trim() === '') {
    rsh.getRange(1, SERIES_RULES_COLS).setValue('Requires Verification')
       .setFontWeight('bold').setBackground(CONFIG.PRIMARY_COLOR).setFontColor('#ffffff');
  }
  return 'Requires Verification columns ready.';
}

/* =================================================================================
 * EMAIL
 * ================================================================================= */
function sendChecklistAssignedEmail(to, p, count) {
  try {
    var label = '';
    CHECKLIST_CONFIG.FREQUENCIES.forEach(function (f) {
      if (f.code === String(p.frequency).toUpperCase().charAt(0)) label = f.label;
    });
    var body = '<p style="font-size:14px;color:#2b3245;">A recurring checklist task has been set up for you.</p>' +
      emailRows([['Task', p.task], ['Frequency', label || p.frequency],
                 ['Starts', prettyDate(p.startDate)], ['Occurrences created', count],
                 ['Proof required', p.proofRequired ? 'Yes' : 'No']]);
    GmailApp.sendEmail(to, '[' + CONFIG.COMPANY_NAME + '] New checklist task',
      'A recurring checklist task has been set up for you: ' + p.task,
      { htmlBody: emailShell('New checklist task', CONFIG.PRIMARY_COLOR, body) });
  } catch (e) { /* never block task creation on a mail failure */ }
}


/* =================================================================================
 * SETUP — run once from the editor
 * ================================================================================= */
function setupChecklistSheet() {
  var ss = getSS();

  var sh = ss.getSheetByName(CHECKLIST_CONFIG.SHEET) || ss.insertSheet(CHECKLIST_CONFIG.SHEET);
  var headers = ['Timestamp', 'Task ID', 'Series ID', 'Doer Name', 'Doer Email', 'Task',
                 'Frequency', 'Day', 'Planned Date', 'Actual Date', 'Status', 'Proof Required',
                 'Proof URL', 'MD Remark', 'EA Remark', 'Assigned By'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground(CONFIG.PRIMARY_COLOR).setFontColor('#ffffff');
  sh.setFrozenRows(1);

  var hl = ss.getSheetByName(CHECKLIST_CONFIG.HOLIDAY_SHEET) ||
           ss.insertSheet(CHECKLIST_CONFIG.HOLIDAY_SHEET);
  hl.getRange(1, 1, 1, 2).setValues([['Holiday Date', 'Description']])
    .setFontWeight('bold').setBackground(CONFIG.PRIMARY_COLOR).setFontColor('#ffffff');
  hl.setFrozenRows(1);

  return 'Checklist and Holiday List sheets are ready.';
}
function setupSeriesRulesSheet() {
  var ss = getSS();
  var sh = ss.getSheetByName(SERIES_RULES_SHEET) || ss.insertSheet(SERIES_RULES_SHEET);
  var headers = ['Series ID', 'Doer', 'Email', 'Task', 'Frequency', 'Week Days', 'Month Days',
                 'Month Ordinals', 'Month Days Of Week', 'Start Date', 'End Date',
                 'Proof Required', 'Assigned By', 'Last Generated Through', 'Created At'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground(CONFIG.PRIMARY_COLOR).setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return 'Series Rules sheet is ready.';
}

/* =================================================================================
 * =================================================================================
 * SECTION 14 — HELP TICKET MODULE
 * Three-step requests (raise -> work update -> review) in the 'Help Ticket' sheet.
 * Uses the same helpers as everything above; no separate spreadsheet or directory.
 * =================================================================================
 * ================================================================================= */

/* ---- Help Ticket sheet column map (0-based) ---- */
var HCOL = {
  TIMESTAMP: 0, TICKET_ID: 1, RAISED_BY: 2, RAISED_EMAIL: 3,
  ASSIGNED_TO: 4, ASSIGNED_EMAIL: 5, DESCRIPTION: 6, PRIORITY: 7,
  DEADLINE: 8, ATTACHMENT: 9,
  S2_AT: 10, S2_STATUS: 11, S2_COMMENT: 12, S2_PROOF: 13, REVISED_DEADLINE: 14,
  S3_AT: 15, S3_STATUS: 16, S3_COMMENT: 17,
  LAST_NOTIFIED: 18, STAGE: 19
};
var HELPTICKET_COLS = 20;

var HELPTICKET_CONFIG = {
  SHEET       : 'Help Ticket',
  S2_STATUSES : ['Pending', 'Ongoing', 'Dependency on third party', 'Revised Date', 'Done'],
  S3_STATUSES : ['Verified & Closed', 'Rejected - Reopen'],
  PRIORITIES  : ['Critical', 'High', 'Medium']
};


/* =================================================================================
 * READ
 * ================================================================================= */

function getHelpTicketBootstrap() {
  var user = requireUser();
  return {
    user       : user,
    doers      : getDoers(),
    tickets    : getHelpTickets(),
    s2Statuses : HELPTICKET_CONFIG.S2_STATUSES,
    s3Statuses : HELPTICKET_CONFIG.S3_STATUSES,
    priorities : HELPTICKET_CONFIG.PRIORITIES
  };
}

/**
 * Admins see every ticket. Everyone else sees tickets they raised or were assigned.
 * Each ticket carries the flags the UI needs, so the page never re-derives permissions.
 */
function getHelpTickets() {
  var user = requireUser();
  var sh   = getHelpTicketSheet();
  var last = sh.getLastRow();
  if (last < 2) return [];

  var rows = sh.getRange(2, 1, last - 1, HELPTICKET_COLS).getValues();
  var me   = user.name.trim().toLowerCase();
  var out  = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!String(r[HCOL.TICKET_ID] || '').trim()) continue;

    var raisedBy = String(r[HCOL.RAISED_BY] || '').trim().toLowerCase();
    var doer     = String(r[HCOL.ASSIGNED_TO] || '').trim().toLowerCase();
    if (user.accessLevel !== 'ADMIN' && raisedBy !== me && doer !== me) continue;

    out.push(helpTicketRowToObject(r, user));
  }
  return out;
}

function helpTicketRowToObject(r, user) {
  var me       = user.name.trim().toLowerCase();
  var raisedBy = String(r[HCOL.RAISED_BY] || '').trim();
  var doer     = String(r[HCOL.ASSIGNED_TO] || '').trim();
  var s2       = String(r[HCOL.S2_STATUS] || 'Pending').trim() || 'Pending';
  var s3       = String(r[HCOL.S3_STATUS] || '').trim();
  var closed   = s3.toLowerCase() === 'verified & closed';

  var isMine   = doer.toLowerCase() === me;
  var isOwner  = raisedBy.toLowerCase() === me;
  var isAdmin  = user.accessLevel === 'ADMIN';

  return {
    timestamp   : fmtDateTime(r[HCOL.TIMESTAMP]),
    ticketId    : String(r[HCOL.TICKET_ID] || '').trim(),
    raisedBy    : raisedBy,
    raisedEmail : String(r[HCOL.RAISED_EMAIL] || '').trim(),
    assignedTo  : doer,
    assignedEmail: String(r[HCOL.ASSIGNED_EMAIL] || '').trim(),
    description : String(r[HCOL.DESCRIPTION] || ''),
    priority    : String(r[HCOL.PRIORITY] || 'Medium').trim(),
    deadline    : fmtDate(r[HCOL.DEADLINE]),
    attachment  : String(r[HCOL.ATTACHMENT] || '').trim(),
    s2At        : fmtDateTime(r[HCOL.S2_AT]),
    s2Status    : s2,
    s2Comment   : String(r[HCOL.S2_COMMENT] || ''),
    s2Proof     : String(r[HCOL.S2_PROOF] || '').trim(),
    revisedDeadline: fmtDate(r[HCOL.REVISED_DEADLINE]),
    s3At        : fmtDateTime(r[HCOL.S3_AT]),
    s3Status    : s3,
    s3Comment   : String(r[HCOL.S3_COMMENT] || ''),
    lastNotified: fmtDateTime(r[HCOL.LAST_NOTIFIED]),
    stage       : String(r[HCOL.STAGE] || '').trim() || (closed ? 'Closed' : 'Open'),
    closed      : closed,
    effectiveDeadline: fmtDate(r[HCOL.REVISED_DEADLINE]) || fmtDate(r[HCOL.DEADLINE]),
    // what this user may do
    canUpdateS2 : !closed && (isMine || isAdmin),
    canReviewS3 : !closed && s2.toLowerCase() === 'done' && (isOwner || isAdmin),
    canNotify   : !closed && (isOwner || isAdmin),
    canReassign : isAdmin || isOwner,
    isMine      : isMine,
    isOwner     : isOwner
  };
}

function getHelpTicketSheet() {
  var sh = getSS().getSheetByName(HELPTICKET_CONFIG.SHEET);
  if (!sh) throw new Error('Sheet "' + HELPTICKET_CONFIG.SHEET +
                           '" was not found. Run setupHelpTicketSheet() once from the editor.');
  return sh;
}

function findHelpTicketRow(ticketId) {
  var sh = getHelpTicketSheet();
  var last = sh.getLastRow();
  if (last < 2) return null;
  var ids = sh.getRange(2, HCOL.TICKET_ID + 1, last - 1, 1).getValues();
  var want = String(ticketId).trim();
  for (var i = 0; i < ids.length; i++) {
    if (checklistIdStr(ids[i][0]) === want) {
      return { sheet: sh, rowNumber: i + 2,
               values: sh.getRange(i + 2, 1, 1, HELPTICKET_COLS).getValues()[0] };
    }
  }
  return null;
}


/* =================================================================================
 * STEP 1 — raise a ticket
 * ================================================================================= */

/** @param {Object} p {assignedTo, description, priority, deadline, attachment} */
function raiseHelpTicket(p) {
  var user = requireUser();
  if (!p.assignedTo)  throw new Error('Choose who the ticket goes to.');
  if (!p.description) throw new Error('Describe what you need.');
  if (!p.deadline)    throw new Error('Choose a deadline.');
  if (p.assignedTo.trim().toLowerCase() === user.name.trim().toLowerCase()) {
    throw new Error('You cannot raise a ticket against yourself.');
  }

  var sh    = getHelpTicketSheet();
  var email = lookupDoerEmail(p.assignedTo);
  var url   = p.attachment ? uploadFileToDrive(p.attachment) : '';

  var ticketId = withLock(function () { return nextHelpTicketId(sh); });

  var row = new Array(HELPTICKET_COLS).fill('');
  row[HCOL.TIMESTAMP]      = new Date();
  row[HCOL.TICKET_ID]      = ticketId;
  row[HCOL.RAISED_BY]      = user.name;
  row[HCOL.RAISED_EMAIL]   = user.email;
  row[HCOL.ASSIGNED_TO]    = p.assignedTo;
  row[HCOL.ASSIGNED_EMAIL] = email;
  row[HCOL.DESCRIPTION]    = p.description;
  row[HCOL.PRIORITY]       = p.priority || 'Medium';
  row[HCOL.DEADLINE]       = p.deadline;
  row[HCOL.ATTACHMENT]     = url;
  row[HCOL.S2_STATUS]      = 'Pending';
  row[HCOL.STAGE]          = 'Open';
  sh.appendRow(row);

  if (email) sendHelpTicketRaisedEmail(email, ticketId, user.name, p);

  return { success: true, ticketId: ticketId,
           message: 'Ticket ' + ticketId + ' raised with ' + p.assignedTo + '.' };
}

function nextHelpTicketId(sheet) {
  var props = PropertiesService.getScriptProperties();
  var next  = parseInt(props.getProperty('HELPTICKET_ID_COUNTER') || '0', 10);
  if (isNaN(next) || next < 0) next = 0;

  var used = {};
  var last = sheet.getLastRow();
  if (last > 1) {
    var ids = sheet.getRange(2, HCOL.TICKET_ID + 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) used[String(ids[i][0]).trim()] = true;
  }
  do { next++; } while (used[String(next)]);
  props.setProperty('HELPTICKET_ID_COUNTER', String(next));
  return String(next);
}

/** Run once from the editor to renumber future tickets from 1. */
function resetHelpTicketIdCounter(startFrom) {
  var from = (startFrom === undefined) ? 0 : Number(startFrom);
  PropertiesService.getScriptProperties().setProperty('HELPTICKET_ID_COUNTER', String(from));
  return 'Next help ticket will be numbered ' + (from + 1) + '.';
}


/* =================================================================================
 * STEP 2 — the doer reports progress
 * ================================================================================= */

/** @param {Object} p {ticketId, status, comment, newDeadline, proof} */
function updateHelpTicketS2(p) {
  var user  = requireUser();
  var found = findHelpTicketRow(p.ticketId);
  if (!found) throw new Error('Ticket ' + p.ticketId + ' was not found.');
  var r = found.values;

  var doer = String(r[HCOL.ASSIGNED_TO]).trim().toLowerCase();
  if (user.accessLevel !== 'ADMIN' && doer !== user.name.trim().toLowerCase()) {
    throw new Error('This ticket is not assigned to you.');
  }
  if (String(r[HCOL.S3_STATUS]).trim().toLowerCase() === 'verified & closed') {
    throw new Error('This ticket is closed.');
  }
  if (!p.status)  throw new Error('Choose a status.');
  if (!p.comment) throw new Error('Add a comment describing the progress.');
  if (p.status === 'Revised Date' && !p.newDeadline) {
    throw new Error('Choose the revised deadline.');
  }

  var sh = found.sheet, row = found.rowNumber;
  sh.getRange(row, HCOL.S2_AT + 1).setValue(new Date());
  sh.getRange(row, HCOL.S2_STATUS + 1).setValue(p.status);
  sh.getRange(row, HCOL.S2_COMMENT + 1)
    .setValue(appendRemark(r[HCOL.S2_COMMENT], p.status + ' — ' + p.comment, user.name));

  if (p.proof) sh.getRange(row, HCOL.S2_PROOF + 1).setValue(uploadFileToDrive(p.proof));
  if (p.status === 'Revised Date') sh.getRange(row, HCOL.REVISED_DEADLINE + 1).setValue(p.newDeadline);

  // A doer marking Done clears any earlier rejection so the ticket returns for review.
  if (p.status === 'Done') {
    sh.getRange(row, HCOL.S3_STATUS + 1).setValue('');
    sh.getRange(row, HCOL.STAGE + 1).setValue('Awaiting review');
    var ownerEmail = r[HCOL.RAISED_EMAIL] || lookupDoerEmail(r[HCOL.RAISED_BY]);
    if (ownerEmail) sendHelpTicketReviewEmail(ownerEmail, r, user.name);
  } else {
    sh.getRange(row, HCOL.STAGE + 1).setValue('Open');
  }

  return { success: true, message: 'Ticket ' + p.ticketId + ' updated.' };
}


/* =================================================================================
 * STEP 3 — the person who raised it reviews
 * ================================================================================= */

/** @param {Object} p {ticketId, status, comment} */
function reviewHelpTicketS3(p) {
  var user  = requireUser();
  var found = findHelpTicketRow(p.ticketId);
  if (!found) throw new Error('Ticket ' + p.ticketId + ' was not found.');
  var r = found.values;

  var owner = String(r[HCOL.RAISED_BY]).trim().toLowerCase();
  if (user.accessLevel !== 'ADMIN' && owner !== user.name.trim().toLowerCase()) {
    throw new Error('Only the person who raised this ticket can review it.');
  }
  if (String(r[HCOL.S2_STATUS]).trim().toLowerCase() !== 'done') {
    throw new Error('The doer has not marked this ticket done yet.');
  }
  if (HELPTICKET_CONFIG.S3_STATUSES.indexOf(p.status) === -1) {
    throw new Error('Choose a review decision.');
  }
  var reopening = p.status === 'Rejected - Reopen';
  if (reopening && !p.comment) throw new Error('Add feedback explaining what still needs doing.');

  var sh = found.sheet, row = found.rowNumber;
  sh.getRange(row, HCOL.S3_AT + 1).setValue(new Date());
  sh.getRange(row, HCOL.S3_STATUS + 1).setValue(p.status);
  if (p.comment) {
    sh.getRange(row, HCOL.S3_COMMENT + 1)
      .setValue(appendRemark(r[HCOL.S3_COMMENT], p.status + ' — ' + p.comment, user.name));
  }

  if (reopening) {
    sh.getRange(row, HCOL.S2_STATUS + 1).setValue('Ongoing');
    sh.getRange(row, HCOL.STAGE + 1).setValue('Reopened');
  } else {
    sh.getRange(row, HCOL.STAGE + 1).setValue('Closed');
  }

  var doerEmail = r[HCOL.ASSIGNED_EMAIL] || lookupDoerEmail(r[HCOL.ASSIGNED_TO]);
  if (doerEmail) sendHelpTicketResultEmail(doerEmail, r, !reopening, p.comment);

  return { success: true,
           message: reopening ? 'Ticket ' + p.ticketId + ' sent back to the doer.'
                              : 'Ticket ' + p.ticketId + ' verified and closed.' };
}


/* =================================================================================
 * REASSIGN / NOTIFY
 * ================================================================================= */

function reassignHelpTicket(ticketId, newDoerName) {
  var user  = requireUser();
  var found = findHelpTicketRow(ticketId);
  if (!found) throw new Error('Ticket ' + ticketId + ' was not found.');
  var r = found.values;

  var owner = String(r[HCOL.RAISED_BY]).trim().toLowerCase();
  if (user.accessLevel !== 'ADMIN' && owner !== user.name.trim().toLowerCase()) {
    throw new Error('Only the person who raised this ticket, or an admin, can reassign it.');
  }
  if (!newDoerName) throw new Error('Choose the new doer.');

  var oldDoer = String(r[HCOL.ASSIGNED_TO]).trim();
  var email   = lookupDoerEmail(newDoerName);

  found.sheet.getRange(found.rowNumber, HCOL.ASSIGNED_TO + 1).setValue(newDoerName);
  found.sheet.getRange(found.rowNumber, HCOL.ASSIGNED_EMAIL + 1).setValue(email);
  found.sheet.getRange(found.rowNumber, HCOL.S2_COMMENT + 1)
       .setValue(appendRemark(r[HCOL.S2_COMMENT],
                 'Reassigned from ' + oldDoer + ' to ' + newDoerName, user.name));

  if (email) {
    sendHelpTicketRaisedEmail(email, ticketId, user.name, {
      description: 'REASSIGNED: ' + r[HCOL.DESCRIPTION],
      priority   : r[HCOL.PRIORITY],
      deadline   : fmtDate(r[HCOL.REVISED_DEADLINE]) || fmtDate(r[HCOL.DEADLINE])
    });
  }
  return { success: true, message: 'Ticket reassigned to ' + newDoerName + '.' };
}

function notifyHelpTicketDoer(ticketId) {
  var user  = requireUser();
  var found = findHelpTicketRow(ticketId);
  if (!found) throw new Error('Ticket ' + ticketId + ' was not found.');
  var r = found.values;

  var owner = String(r[HCOL.RAISED_BY]).trim().toLowerCase();
  if (user.accessLevel !== 'ADMIN' && owner !== user.name.trim().toLowerCase()) {
    throw new Error('Only the person who raised this ticket, or an admin, can send a reminder.');
  }
  var email = r[HCOL.ASSIGNED_EMAIL] || lookupDoerEmail(r[HCOL.ASSIGNED_TO]);
  if (!email) throw new Error('No email address on file for ' + r[HCOL.ASSIGNED_TO] + '.');

  var body = '<p style="font-size:14px;color:#2b3245;">This help ticket is still open and needs your update.</p>' +
    emailRows([['Ticket', r[HCOL.TICKET_ID]], ['Request', r[HCOL.DESCRIPTION]],
               ['Raised by', r[HCOL.RAISED_BY]],
               ['Deadline', prettyDate(fmtDate(r[HCOL.REVISED_DEADLINE]) || fmtDate(r[HCOL.DEADLINE]))],
               ['Current status', r[HCOL.S2_STATUS]]]);
  GmailApp.sendEmail(email, '[' + CONFIG.COMPANY_NAME + '] Reminder — help ticket ' + r[HCOL.TICKET_ID],
    'Reminder for help ticket ' + r[HCOL.TICKET_ID],
    { htmlBody: emailShell('Help ticket reminder', '#D97706', body) });

  found.sheet.getRange(found.rowNumber, HCOL.LAST_NOTIFIED + 1).setValue(new Date());
  return { success: true, message: 'Reminder sent to ' + r[HCOL.ASSIGNED_TO] + '.' };
}


/* =================================================================================
 * EMAIL
 * ================================================================================= */
function sendHelpTicketRaisedEmail(to, ticketId, from, p) {
  try {
    var body = '<p style="font-size:14px;color:#2b3245;">' + from + ' has raised a help ticket with you.</p>' +
      emailRows([['Ticket', ticketId], ['Request', p.description],
                 ['Priority', p.priority || 'Medium'], ['Deadline', prettyDate(p.deadline)]]);
    GmailApp.sendEmail(to, '[' + CONFIG.COMPANY_NAME + '] New help ticket — ' + ticketId,
      from + ' raised a help ticket with you.',
      { htmlBody: emailShell('New help ticket', CONFIG.PRIMARY_COLOR, body) });
  } catch (e) { /* never block on mail */ }
}

function sendHelpTicketReviewEmail(to, r, doerName) {
  try {
    var body = '<p style="font-size:14px;color:#2b3245;">' + doerName +
      ' has marked your help ticket done. It is waiting for your review.</p>' +
      emailRows([['Ticket', r[HCOL.TICKET_ID]], ['Request', r[HCOL.DESCRIPTION]],
                 ['Doer', r[HCOL.ASSIGNED_TO]]]);
    GmailApp.sendEmail(to, '[' + CONFIG.COMPANY_NAME + '] Review needed — help ticket ' + r[HCOL.TICKET_ID],
      'A help ticket is waiting for your review.',
      { htmlBody: emailShell('Review needed', '#7C3AED', body) });
  } catch (e) { /* never block on mail */ }
}

function sendHelpTicketResultEmail(to, r, closed, comment) {
  try {
    var body = closed
      ? '<p style="font-size:14px;color:#2b3245;">Your work has been verified and the ticket is closed.</p>' +
        emailRows([['Ticket', r[HCOL.TICKET_ID]], ['Request', r[HCOL.DESCRIPTION]]])
      : '<p style="font-size:14px;color:#2b3245;">This ticket has been sent back to you.</p>' +
        emailRows([['Ticket', r[HCOL.TICKET_ID]], ['Request', r[HCOL.DESCRIPTION]], ['Feedback', comment]]);
    GmailApp.sendEmail(to,
      '[' + CONFIG.COMPANY_NAME + '] Help ticket ' + (closed ? 'closed' : 'reopened') + ' — ' + r[HCOL.TICKET_ID],
      closed ? 'Your help ticket was verified and closed.' : 'Your help ticket was reopened.',
      { htmlBody: emailShell(closed ? 'Ticket closed' : 'Ticket reopened',
                             closed ? '#16A34A' : '#DC2626', body) });
  } catch (e) { /* never block on mail */ }
}


/* =================================================================================
 * SETUP — run once from the editor
 * ================================================================================= */
function setupHelpTicketSheet() {
  var ss = getSS();
  var sh = ss.getSheetByName(HELPTICKET_CONFIG.SHEET) || ss.insertSheet(HELPTICKET_CONFIG.SHEET);
  var headers = ['Timestamp', 'Ticket ID', 'Raised By', 'Raised By Email',
                 'Assigned To', 'Assigned To Email', 'Description', 'Priority',
                 'Deadline', 'Attachment', 'S2 Updated At', 'S2 Status', 'S2 Comment',
                 'S2 Proof', 'Revised Deadline', 'S3 Reviewed At', 'S3 Status',
                 'S3 Comment', 'Last Notified', 'Stage'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground(CONFIG.PRIMARY_COLOR).setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return 'Help Ticket sheet is ready.';
}

function debugNav() {
  var user = getUserSession();
  var out = ['Pages defined: ' + Object.keys(PAGES).join(', ')];
  out.push('Session: ' + (user ? user.name + ' (' + user.accessLevel + ')' : 'none — sign in first'));
  if (user) {
    out.push('Tabs this user should see: ' + getNavContext().links.map(function(l){ return l.title; }).join(', '));
  }
  var files = ['Checklist', 'HelpTicket'];
  files.forEach(function (f) {
    try { HtmlService.createTemplateFromFile(f); out.push('HTML file "' + f + '" — found'); }
    catch (e) { out.push('HTML file "' + f + '" — MISSING'); }
  });
  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}
function checkSpreadsheetLink() {
  var ss = getSS();
  Logger.log('Script is reading from: "' + ss.getName() + '" — ID: ' + ss.getId());
  Logger.log('URL: ' + ss.getUrl());
  var hl = ss.getSheetByName(CHECKLIST_CONFIG.HOLIDAY_SHEET);
  Logger.log('Holiday List sheet found: ' + (hl ? 'YES, ' + (hl.getLastRow()-1) + ' data row(s)' : 'NO'));
}


/**
 * TEST FUNCTION: Run this from the Apps Script editor anytime to test the 4 PM email.
 */
function testDailyDueTaskEmails() {
  var today = fmtDate(new Date());
  Logger.log('=== TESTING 4 PM EMAIL TRIGGER ===');
  Logger.log('Today\'s Date: ' + today);

  // 1. Check Holiday
  var holidaySet = loadHolidayDateStrings();
  if (holidaySet.indexOf(today) !== -1) {
    Logger.log('ABORTED: Today is marked as a Holiday in Holiday List sheet. No emails sent.');
    return 'Today is a holiday. No emails sent.';
  }

  var byDoer = {}; 
  var delegationCount = 0;
  var checklistCount = 0;

  // 2. Scan Master Sheet (Delegation)
  try {
    var sh = getSheet(CONFIG.MASTER_SHEET);
    var last = sh.getLastRow();
    if (last >= 2) {
      var rows = sh.getRange(2, 1, last - 1, Math.max(sh.getLastColumn(), MASTER_COLS)).getValues();
      rows.forEach(function (r) {
        var status = (r[COL.STATUS] || '').toString().trim();
        var planned = fmtDate(r[COL.REV1]) || fmtDate(r[COL.PLANNED]) || fmtDate(r[COL.DUE]);

        // Only Pending tasks due today
        if (status === 'Pending' && planned === today) {
          var email = (r[COL.EMAIL] || '').toString().trim() || lookupDoerEmail(r[COL.ASSIGNED_TO]);
          var doerName = (r[COL.ASSIGNED_TO] || '').toString().trim();
          if (email) {
            var entry = byDoer[email] || (byDoer[email] = { name: doerName, items: [] });
            entry.items.push({ taskId: r[COL.TASK_ID], task: (r[COL.TASK] || '').toString(), type: 'Delegation' });
            delegationCount++;
          }
        }
      });
    }
  } catch (e) {
    Logger.log('Master sheet error: ' + e.message);
  }

  // 3. Scan Checklist Sheet
  try {
    var csh = getChecklistSheet();
    var clast = csh.getLastRow();
    if (clast >= 2) {
      var crows = csh.getRange(2, 1, clast - 1, CHECKLIST_COLS).getValues();
      crows.forEach(function (r) {
        var status = String(r[CCOL.STATUS] || '').trim();
        var planned = fmtDate(r[CCOL.PLANNED]);

        // Only Pending tasks due today
        if (status === 'Pending' && planned === today) {
          var email = String(r[CCOL.EMAIL] || '').trim() || lookupDoerEmail(r[CCOL.DOER]);
          var doerName = String(r[CCOL.DOER] || '').trim();
          if (email) {
            var entry = byDoer[email] || (byDoer[email] = { name: doerName, items: [] });
            entry.items.push({ taskId: r[CCOL.TASK_ID], task: String(r[CCOL.TASK] || ''), type: 'Checklist' });
            checklistCount++;
          }
        }
      });
    }
  } catch (e) {
    Logger.log('Checklist sheet error: ' + e.message);
  }

  Logger.log('Pending Delegation Tasks found for today: ' + delegationCount);
  Logger.log('Pending Checklist Tasks found for today: ' + checklistCount);

  var emails = Object.keys(byDoer);
  if (emails.length === 0) {
    Logger.log('RESULT: No pending tasks found for today (' + today + '). Koi mail nahi gaya.');
    Logger.log('TIP: Check karne ke liye sheet mein kisi task ki Planned Date AAJ ki kijiye aur Status "Pending" rakhiye.');
    return 'No pending tasks found for today.';
  }

  // 4. Send Consolidated Emails
  emails.forEach(function (email) {
    var info = byDoer[email];
    var rowsHtml = info.items.map(function (it) {
      return '<li style="margin-bottom:6px;"><strong>[' + esc11(it.type) + ']</strong> ' +
             esc11(it.taskId) + ' — ' + esc11(it.task) + '</li>';
    }).join('');
    var body = '<p style="font-size:14px;color:#2b3245;">Hi ' + esc11(info.name) +
               ', these tasks are due today.</p>' +
               '<ul style="font-size:14px;color:#2b3245;padding-left:18px;">' + rowsHtml + '</ul>';

    GmailApp.sendEmail(email, '[' + CONFIG.COMPANY_NAME + '] Tasks due today (TEST)',
      'You have tasks due today.', { htmlBody: emailShell('Tasks due today', CONFIG.PRIMARY_COLOR, body) });

    Logger.log('SUCCESS: Mail sent to ' + email + ' (' + info.name + ') with ' + info.items.length + ' task(s).');
  });

  Logger.log('=== TEST COMPLETED ===');
  return 'Mail sent successfully to ' + emails.length + ' doer(s)!';
}

/** Read-only master list of every recurring series defined in Series Rules. */
function getSeriesMasterList() {
  var user = requireUser();
  if (user.accessLevel === 'DOER') throw new Error('Only admins and team leads can view the master list.');
  var sh = getSS().getSheetByName(SERIES_RULES_SHEET);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, SERIES_RULES_COLS).getValues();
  var out = [];
  rows.forEach(function (r) {
    var seriesId = String(r[SCOL.SERIES_ID] || '').trim();
    if (!seriesId) return;
    out.push({
      seriesId    : seriesId,
      doer        : String(r[SCOL.DOER] || '').trim(),
      task        : String(r[SCOL.TASK] || '').trim(),
      frequency   : String(r[SCOL.FREQUENCY] || '').trim(),
      startDate   : fmtDate(r[SCOL.START_DATE]),
      endDate     : fmtDate(r[SCOL.END_DATE]),
      proofRequired: String(r[SCOL.PROOF_REQ] || 'No').trim(),
      assignedBy  : String(r[SCOL.ASSIGNED_BY] || '').trim(),
      lastGeneratedThrough: fmtDate(r[SCOL.LAST_GENERATED_THROUGH]),
      createdAt   : fmtDateTime(r[SCOL.CREATED_AT])
    });
  });
  return out.sort(function (a, b) { return a.doer.localeCompare(b.doer) || a.task.localeCompare(b.task); });
}

/** 
 * IMMEDIATE EMAIL BUTTON 
 * Sends the new task assignment email instantly (bypassing the 4 PM batch).
 */
/** 
 * IMMEDIATE EMAIL BUTTON 
 */
function sendImmediateTaskEmail(taskId) {
  var found = findTaskRow(taskId);
  if (!found) throw new Error('Task ' + taskId + ' was not found.');
  
  var user = requireTaskOwner(found.values);
  var r = found.values;

  var doerName = (r[COL.ASSIGNED_TO] || '').toString().trim();
  // Email nikalna
  var email = (r[COL.EMAIL] || '').toString().trim() || lookupDoerEmail(doerName);
  
  if (!email) throw new Error(doerName + ' ki email ID system mein nahi mili. Kripya Doer List check karein.');

  var locIdx = getLocationColIndex(found.sheet);

  var taskObj = {
    taskId: r[COL.TASK_ID],
    task: r[COL.TASK],
    doer: doerName,
    assignedBy: r[COL.ASSIGNED_BY],
    dueDate: fmtDate(r[COL.REV1]) || fmtDate(r[COL.PLANNED]) || fmtDate(r[COL.DUE]),
    priority: r[COL.PRIORITY],
    location: r[locIdx],
    proofReq: r[COL.PROOF_REQ],
    voice: r[COL.VOICE],
    docs: (r[COL.DOCS] || '').toString().split(',').filter(String)
  };

  sendTaskNotificationEmail(email, taskObj);

  // YE LINE CHANGE KI HAI - Ab screen par Email ID dikhegi
  return { success: true, message: 'Email sent successfully to: ' + email };
}

/** UPDATE — Approve Checklist Task */
function approveChecklistTask(taskId) {
  var found = findChecklistRow(taskId);
  if (!found) throw new Error('Checklist task ' + taskId + ' was not found.');
  var user = requireUser();
  
  found.sheet.getRange(found.rowNumber, CCOL.STATUS + 1).setValue('Done');
  found.sheet.getRange(found.rowNumber, CCOL.MD_REMARK + 1)
       .setValue(appendRemark(found.values[CCOL.MD_REMARK], 'Approved', user.name));
       
  return { success: true, message: 'Checklist task approved.' };
}

/** UPDATE — Reject Checklist Task */
function disapproveChecklistTask(taskId, reason) {
  if (!reason || !reason.toString().trim()) throw new Error('Enter a reason before disapproving.');
  var found = findChecklistRow(taskId);
  if (!found) throw new Error('Checklist task ' + taskId + ' was not found.');
  var user = requireUser();

  found.sheet.getRange(found.rowNumber, CCOL.STATUS + 1).setValue('Pending');
  found.sheet.getRange(found.rowNumber, CCOL.ACTUAL + 1).setValue(''); // Submited date hata di jayegi
  found.sheet.getRange(found.rowNumber, CCOL.MD_REMARK + 1)
       .setValue(appendRemark(found.values[CCOL.MD_REMARK], 'Disapproved — ' + reason, user.name));
       
  return { success: true, message: 'Checklist task sent back for rework.' };
}


function debugListSeriesIds() {
  var sh = getChecklistSheet();
  var last = sh.getLastRow();
  if (last < 2) { Logger.log('No rows in Checklist sheet.'); return; }
  var ids = sh.getRange(2, CCOL.SERIES_ID + 1, last - 1, 1).getValues().map(function(r){ return r[0]; });
  var uniq = [...new Set(ids)];
  Logger.log('Total rows: ' + ids.length);
  Logger.log('Last 20 distinct Series IDs: ' + uniq.slice(-20).join(', '));
}


function testDeleteSeries() {
  var result = deleteChecklistSeries('S3853', false);
  Logger.log(result.message);
}

/** Delete multiple recurring series (by Series ID) in one call. Same rules as
 *  deleteChecklistSeries() applied to each, aggregated into one message.
 *  Also keeps "Checklist Master" (Series Rules) in sync for every series involved. */
function deleteChecklistSeriesBulk(seriesIds, futureOnly) {
  var user = requireUser();
  if (user.accessLevel === 'DOER') throw new Error('Only admins and team leads can delete checklist tasks.');
  if (!seriesIds || !seriesIds.length) throw new Error('Choose at least one recurring task.');

  var sh   = getChecklistSheet();
  var last = sh.getLastRow();
  if (last < 2) throw new Error('There are no checklist tasks yet.');

  var wantSeries = {};
  seriesIds.forEach(function (id) { wantSeries[String(id).trim()] = true; });

  var rows   = sh.getRange(2, 1, last - 1, CHECKLIST_COLS).getValues();
  var today  = new Date(); today.setHours(0, 0, 0, 0);
  var toKill = [];
  var affectedSeries = {};

  for (var i = 0; i < rows.length; i++) {
    var sid = String(rows[i][CCOL.SERIES_ID]).trim();
    if (!wantSeries[sid]) continue;
    if (user.accessLevel === 'TL' &&
        String(rows[i][CCOL.ASSIGNED_BY]).trim().toLowerCase() !== user.name.trim().toLowerCase()) {
      throw new Error('You can only delete checklist tasks you created.');
    }
    if (futureOnly) {
      var planned = rows[i][CCOL.PLANNED];
      if (String(rows[i][CCOL.STATUS]).trim() === 'Done') continue;
      if (planned instanceof Date && planned < today) continue;
    }
    toKill.push(i + 2);
    affectedSeries[sid] = true;
  }
  if (!toKill.length) throw new Error('No matching occurrences found.');

  toKill.sort(function (a, b) { return b - a; });
  var i2 = 0;
  while (i2 < toKill.length) {
    var start = toKill[i2], count = 1;
    while (i2 + 1 < toKill.length && toKill[i2 + 1] === toKill[i2] - 1) { i2++; start = toKill[i2]; count++; }
    sh.deleteRows(start, count);
    i2++;
  }

  // Keep "Checklist Master" (Series Rules) in sync for every affected series.
  try {
    var remainingLast = sh.getLastRow();
    var remainingSeriesIds = {};
    if (remainingLast >= 2) {
      var remainingIds = sh.getRange(2, CCOL.SERIES_ID + 1, remainingLast - 1, 1).getValues();
      remainingIds.forEach(function (r) {
        var v = String(r[0] || '').trim();
        if (v) remainingSeriesIds[v] = true;
      });
    }
    var rulesSheet = getSS().getSheetByName(SERIES_RULES_SHEET);
    if (rulesSheet) {
      Object.keys(affectedSeries).forEach(function (sid) {
        var rLast = rulesSheet.getLastRow();
        if (rLast < 2) return;
        var rRows = rulesSheet.getRange(2, 1, rLast - 1, SERIES_RULES_COLS).getValues();
        for (var ri = 0; ri < rRows.length; ri++) {
          if (String(rRows[ri][SCOL.SERIES_ID]).trim() !== sid) continue;
          var ruleRowNum = ri + 2;
          if (!futureOnly || !remainingSeriesIds[sid]) {
            // Every occurrence gone (or nothing was left even in future-only mode) — remove the rule too.
            rulesSheet.deleteRow(ruleRowNum);
          } else {
            // Some past/completed rows remain — just stop it from generating any more.
            var stopDate = new Date(); stopDate.setDate(stopDate.getDate() - 1);
            rulesSheet.getRange(ruleRowNum, SCOL.END_DATE + 1).setValue(stopDate);
            rulesSheet.getRange(ruleRowNum, SCOL.LAST_GENERATED_THROUGH + 1).setValue(stopDate);
          }
          break;
        }
      });
    }
  } catch (e) { /* Series Rules sheet is optional/legacy-safe */ }

  return { success: true,
           message: toKill.length + ' occurrence' + (toKill.length === 1 ? '' : 's') +
                    ' deleted across ' + Object.keys(affectedSeries).length + ' recurring task(s).' };
}
/** Turns a Task ID cell back into text, even if Sheets auto-converted it to a date. */
var _SS_TZ = null;
function checklistIdStr(v) {
  if (v instanceof Date) {
    if (!_SS_TZ) _SS_TZ = getSS().getSpreadsheetTimeZone();
    return Utilities.formatDate(v, _SS_TZ, 'yyyy') + '-' + Number(Utilities.formatDate(v, _SS_TZ, 'M'));
  }
  return String(v == null ? '' : v).trim();
}

/** RUN ONCE FROM THE EDITOR: repairs Task IDs that Sheets turned into dates and locks column B as plain text. */
function fixChecklistTaskIds() {
  var sh = getChecklistSheet();
  var last = sh.getLastRow();
  if (last < 2) return 'No rows.';
  var rng = sh.getRange(2, CCOL.TASK_ID + 1, last - 1, 1);
  var vals = rng.getValues();
  var fixed = 0;
  var out = vals.map(function (r) {
    if (r[0] instanceof Date) fixed++;
    return [checklistIdStr(r[0])];
  });
  sh.getRange(2, CCOL.TASK_ID + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
  rng.setValues(out);
  var msg = fixed + ' Task ID(s) repaired. Column B is now plain text.';
  Logger.log(msg);
  return msg;
}

var ALLOWED_DOMAIN = 'ugesl.com';
var NO_AUTO_KEY    = 'no_auto_login';

/** Email of the Google account signed in on this device ('' if none / not visible). */
function getGoogleAccountEmail() {
  try { return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase(); }
  catch (e) { return ''; }
}

function isAllowedGoogleAccount(email) {
  return !!email && email.split('@')[1] === ALLOWED_DOMAIN;
}

/** Signs the user in automatically from their UGESL Google account — no password needed. */
function tryAutoLogin() {
  var gEmail = getGoogleAccountEmail();
  if (!isAllowedGoogleAccount(gEmail)) return null;
  if (CacheService.getUserCache().get(NO_AUTO_KEY)) return null;   // user chose to sign out

  var hit = findDoerRowByEmail(gEmail);
  if (!hit) return null;
  var row = hit.row;
  if (String(row[DCOL.STATUS] || 'Active').trim().toLowerCase() === 'inactive') return null;

  var user = {
    email       : String(row[DCOL.EMAIL] || '').trim(),
    name        : String(row[DCOL.NAME]  || '').trim(),
    role        : String(row[DCOL.ROLE]  || '').trim(),
    role1       : String(row[DCOL.ROLE1] || '').trim(),
    accessLevel : getUserAccessLevel(row[DCOL.ROLE], row[DCOL.ROLE1]),
    timestamp   : new Date().toISOString()
  };
  setUserSession(user);
  CacheService.getUserCache().put(NAV_KEY, defaultPageFor(user.accessLevel), NAV_TTL);
  return user;
}