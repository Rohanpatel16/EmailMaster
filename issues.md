# EmailMaster — Issues & Known Bugs

> Full codebase analysis of `index.html`, `app.js` (1,159 lines), `index.css`. Last updated: 2026-02-23.

---

## 🔴 Critical Bugs

### #1 — `renameProject` Uses Native `prompt()` (Not Custom Modal)
- **File**: `app.js:535`
- **Issue**: `renameProject()` still uses the native browser `prompt()` dialog, which is blocked on some browsers and looks bad — inconsistent with the rest of the app that now uses `showModal`.
- **Impact**: Breaks the rename flow entirely on GitHub Pages in strict contexts.
- **Fix**: Replace `prompt()` with a modal that contains an `<input>` field.

### #2 — `exportDatabase()` Still Uses Native `alert()`
- **File**: `app.js:1126`
- **Issue**: `if (fullDbCache.length === 0) { alert('Database is empty.'); }` — one remaining native `alert()` that was missed during the modal migration.
- **Impact**: Inconsistent UI, shows browser popup.
- **Fix**: Replace with `showModal(...)`.

### #3 — `markBatchAsSent` Reads Cooldown From DOM Instead of State
- **File**: `app.js:578`
- **Issue**: `const cooldown = document.getElementById('cooldown-period').value;` — this variable is declared but **never used**. The actual save uses `state.cooldownPeriod`. The DOM read is dead code that creates confusion.
- **Impact**: No functional impact currently, but could cause a silent bug if the DOM gets out of sync with state.
- **Fix**: Remove the dead `cooldown` variable declaration.

### #4 — `parseDuration` Has a Duplicate Condition
- **File**: `app.js:217`
- **Issue**: `if (duration === 'never' || duration === 'never')` — the same check is written twice. Also `0` value (the "None/Show Duplicates" option) isn't handled and falls through to `return 0`, which makes the `expiresAt` timestamp `Date.now() + 0 = Date.now()`, meaning the email is **immediately out of cooldown**.
- **Impact**: "None (Show Duplicates)" cooldown doesn't actually work as intended — emails are re-shown right away.
- **Fix**: Add an explicit `if (duration === '0') return 0;` block and remove the duplicate condition.

---

## 🟠 High Priority Issues

### #5 — Project `sentCount` Desyncs on Multi-Batch Undo
- **File**: `app.js:609`
- **Issue**: When undoing a batch, `sentCount` is decremented by 1 **per email**, but this is done individually. If the project's `sentCount` was already lower than the number of items being unmarked (e.g., after re-processing the same project), `sentCount` can go negative even with the `Math.max(0, ...)` guard.
- **Impact**: Project History shows incorrect "X% Sent" progress after undo operations.
- **Fix**: Recalculate `sentCount` by counting `isSent === true` items instead of decrementing.

### #6 — `loadProject` Doesn't Reset `state.batches`
- **File**: `app.js:557-571`
- **Issue**: When loading a project from history, `processEmails()` is called but `state.activeProject` is set before the call. If the user had a previous project loaded, the **old batch state persists briefly** until re-processing finishes (race condition on slow devices).
- **Impact**: Can cause `currentBatchIndex` to be out of range temporarily, leading to "No valid emails found" flash.
- **Fix**: Reset `state.batches = []` and `state.currentBatchIndex = 0` before calling `processEmails()`.

### #7 — `renderDatabaseView` Re-runs Email Regex on All Project Raw Inputs
- **File**: `app.js:1018`
- **Issue**: Every time the Database tab is opened, all project `rawInput` strings are re-parsed with the email regex. For large projects with megabytes of raw text, this is very slow and blocks the UI thread.
- **Impact**: UI freeze or noticeable delay when switching to the Database tab.
- **Fix**: Store extracted email lists in the project object at processing time, rather than re-extracting on every DB view.

### #8 — `migrateFromLocalStorage` Overwrites IndexedDB Data Every Time
- **File**: `app.js:699-723`
- **Issue**: Migration runs on every `initApp()` call. It doesn't check if migration was already completed (the `localStorage` keys are never removed — see line 713 comment: "Keeping for safety for now"). If old `localStorage` data is stale (e.g., empty arrays), it overwrites good IndexedDB data.
- **Impact**: Can cause user's block/allow lists to be silently cleared on refresh if old `localStorage` keys exist.
- **Fix**: After successful migration, remove the `localStorage` keys. Or write a `migrationDone` flag to IndexedDB.

---

## 🟡 Medium Priority Issues

### #9 — `rebuildRegex` Crashes if `keywordsList` or `tldList` is Empty
- **File**: `app.js:231-236`
- **Issue**: `state.keywordsList.join('|')` produces an empty string if the list is empty, creating the regex `/()/i` which is a valid but problematic regex that matches every string.
- **Impact**: If user removes all keywords, every email domain will match as a keyword, blocking everything.
- **Fix**: Add a guard: `if (!keywordsList.length) CONFIG.keywordRegex = null;` and check for `null` before testing.

### #10 — `copyCurrentBatch` Silently Fails With No Error Handling
- **File**: `app.js:662`
- **Issue**: `navigator.clipboard.writeText()` can fail if the page doesn't have clipboard permissions (common on GitHub Pages with stricter permissions). The `.then()` is used but there's no `.catch()`.
- **Impact**: User clicks "Copy Batch" and nothing happens — no feedback.
- **Fix**: Add `.catch(() => showToast('Copy failed. Please copy manually.', 'danger'))`.

### #11 — `switchTab('processor')` Calls `renderResults()` Unnecessarily
- **File**: `app.js:253`
- **Issue**: Every time the user clicks on the Processor tab, `renderResults()` is called even if nothing has changed. This re-renders the full email table on every tab switch.
- **Impact**: Minor unnecessary DOM manipulation; can cause visual flash.
- **Fix**: Only call `renderResults()` if `state.allEmails.length > 0`.

### #12 — Project History Cards Display `NaN%` for Empty Projects
- **File**: `app.js:511`
- **Issue**: `Math.round((proj.sentCount / proj.totalValid) * 100) || 0` — if `proj.totalValid` is `0` (edge case where no valid emails were found), this produces `NaN`, and the `|| 0` fallback correctly handles it. However, this **doesn't guard against `undefined`** on `sentCount` for old projects created before the `sentCount` field was added.
- **Impact**: Old projects show `NaN% Sent` or `undefined / 0 Emails`.
- **Fix**: Normalize with: `const sentCount = proj.sentCount || 0; const totalValid = proj.totalValid || 0;`.

### #13 — Domain Filter Tags Allow HTML Injection (XSS)
- **File**: `app.js:842-856`
- **Issue**: Domain tags in the Block/Allow list are rendered using template literals injected into `innerHTML`. If a malicious domain name contains `<script>` or other HTML, it will be injected into the DOM.
- **Impact**: Low severity locally, but the app stores whatever string the user pastes. Names like `<img src=x onerror=alert(1)>` would execute.
- **Fix**: Use `textContent` assignments instead of `innerHTML` for user-provided values, or sanitize with a helper.

---

## 🟢 Low Priority / UX Issues

### #14 — No Visual Feedback After "Export Lists" in Domain Filters
- **File**: `app.js:877`
- **Issue**: `showToast('Filters exported.')` is shown, but the exported filename is not communicated. Users on GitHub Pages might not see the download begin.
- **Suggestion**: Toast should say "Filters exported as `email_master_filters_2026-02-23.json`".

### #15 — "Reset Tool" in Sidebar Lacks Visual Separation
- **File**: `index.html:37`
- **Issue**: "Reset Tool" (factory reset) sits in the sidebar with only a thin `sidebar-divider` above it. On shorter screens or with long nav items, it's easy to accidentally click.
- **Suggestion**: Add more spacing or a confirmation-only-on-click warning state.

### #16 — `filterDatabaseView` Not Called on Initial DB Tab Open
- **File**: `app.js:252`
- **Issue**: When switching to the DB tab, `renderDatabaseView()` is called, which fetches all data. If a search query was left in the input from a previous visit, it's applied inside `renderDatabaseView()` — but the "Clear Search" button state (`display: none`) is not reset.
- **Impact**: Clear button may be hidden even though a search is active.
- **Fix**: Call `clearDatabaseSearch()` or sync the clear button visibility when the DB tab opens.

### #17 — Settings Tab Has No "Save" Button — Auto-Save Is Silent
- **File**: `app.js:755-762`
- **Issue**: Keywords, TLDs, and filter changes auto-save to IndexedDB with no confirmation. Users unfamiliar with the app may not know their changes are being persisted.
- **Suggestion**: Show a subtle "Saved" toast when any filter list is modified.

### #18 — `500_emails.txt` Test File is Committed to the Repository
- **File**: Project root
- **Issue**: `500_emails.txt` (378KB) contains real-looking email addresses and is tracked in git. This bloats the repo and may be a privacy concern.
- **Suggestion**: Add `*.txt` test data to `.gitignore`.

---

## ✅ Recently Resolved

| Issue | Status |
|---|---|
| Native browser dialogs (`alert`/`confirm`) blocking GitHub Pages | ✅ Fixed — Custom modal system |
| Settings (batch size, cooldown) resetting on refresh | ✅ Fixed — IndexedDB persistence |
| `localStorage` 5MB limit causing data loss | ✅ Fixed — IndexedDB migration |
| "Undo Batch" not reverting sent status | ✅ Fixed — State + DB sync |
| `db is undefined` crash on fast page loads | ✅ Fixed — `ensureDB()` guard |
