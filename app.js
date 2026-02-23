// --- Constants & Defaults ---
const DEFAULTS = {
    keywords: ["consultancy", "manpower", "recruitment", "recruit", "agency", "recruiting", "placement", "hire", "talent", "job", "staff", "people", "jobs", "search", "human"],
    tlds: [".edu", ".ac.in", ".edu.in", ".education"]
};

// Consumer/personal email providers — never counted as "New Domains"
const CONSUMER_DOMAINS = new Set([
    'gmail.com', 'yahoo.com', 'hotmail.com', 'aol.com', 'hotmail.co.uk', 'hotmail.fr',
    'msn.com', 'yahoo.fr', 'wanadoo.fr', 'orange.fr', 'comcast.net', 'yahoo.co.uk',
    'yahoo.com.br', 'yahoo.co.in', 'live.com', 'rediffmail.com', 'free.fr', 'gmx.de',
    'web.de', 'yandex.ru', 'ymail.com', 'libero.it', 'outlook.com', 'uol.com.br',
    'bol.com.br', 'mail.ru', 'cox.net', 'hotmail.it', 'sbcglobal.net', 'sfr.fr',
    'live.fr', 'verizon.net', 'live.co.uk', 'googlemail.com', 'yahoo.es', 'ig.com.br',
    'live.nl', 'bigpond.com', 'terra.com.br', 'yahoo.it', 'neuf.fr', 'yahoo.de',
    'alice.it', 'rocketmail.com', 'att.net', 'laposte.net', 'facebook.com', 'bellsouth.net',
    'yahoo.in', 'hotmail.es', 'charter.net', 'yahoo.ca', 'yahoo.com.au', 'rambler.ru',
    'hotmail.de', 'tiscali.it', 'shaw.ca', 'yahoo.co.jp', 'sky.com', 'earthlink.net',
    'optonline.net', 'freenet.de', 't-online.de', 'aliceadsl.fr', 'virgilio.it', 'home.nl',
    'qq.com', 'telenet.be', 'me.com', 'yahoo.com.ar', 'tiscali.co.uk', 'yahoo.com.mx',
    'voila.fr', 'gmx.net', 'mail.com', 'planet.nl', 'tin.it', 'live.it', 'ntlworld.com',
    'arcor.de', 'yahoo.co.id', 'frontiernet.net', 'hetnet.nl', 'live.com.au', 'yahoo.com.sg',
    'zonnet.nl', 'club-internet.fr', 'juno.com', 'optusnet.com.au', 'blueyonder.co.uk',
    'bluewin.ch', 'skynet.be', 'sympatico.ca', 'windstream.net', 'mac.com', 'centurytel.net',
    'chello.nl', 'live.ca', 'aim.com', 'bigpond.net.au',
    // Zoho
    'zoho.com', 'zohomail.com', 'zohomail.in', 'zoho.in'
]);

// --- Global State ---
let state = {
    allEmails: [],
    validEmails: [],
    blockedEmails: [],
    filteredView: null, // 'total', 'valid', 'blocked', 'new'
    masterBlockList: [],
    masterAllowList: [],
    keywordsList: [...DEFAULTS.keywords],
    tldList: [...DEFAULTS.tlds],
    batches: [],
    currentBatchIndex: 0,
    activeProject: null,
    dbCurrentPage: 1,
    dbFilteredEmails: [],
    // Persisted UI Settings
    batchSize: 25,
    cooldownPeriod: 'never'
};

let CONFIG = {
    emailRegex: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
    keywordRegex: null,
    eduTldRegex: null
};

// --- Native IndexedDB Manager ---
const dbName = "EmailMasterDB";
const dbVersion = 2; // Upgraded for settings and filters
let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, dbVersion);

        request.onupgradeneeded = (e) => {
            const upgradedDb = e.target.result;
            const oldVersion = e.oldVersion;

            if (oldVersion < 1) {
                upgradedDb.createObjectStore('sentEmails', { keyPath: 'email' });
                upgradedDb.createObjectStore('projects', { keyPath: 'id' });
            }
            if (oldVersion < 2) {
                if (!upgradedDb.objectStoreNames.contains('settings')) {
                    upgradedDb.createObjectStore('settings', { keyPath: 'key' });
                }
                if (!upgradedDb.objectStoreNames.contains('filters')) {
                    upgradedDb.createObjectStore('filters', { keyPath: 'type' });
                }
            }
        };

        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };

        request.onerror = (e) => reject(e.target.error);
    });
}

// DB Helpers
async function ensureDB() {
    if (!db) await initDB();
    return db;
}

async function saveSentEmail(email, cooldown) {
    const currentDb = await ensureDB();
    const expiresAt = cooldown === 'never' ? Number.MAX_SAFE_INTEGER : Date.now() + parseDuration(cooldown);
    const tx = currentDb.transaction('sentEmails', 'readwrite');
    const store = tx.objectStore('sentEmails');
    await store.put({ email, lastSent: Date.now(), expiresAt });
}

async function getSentStatus(email) {
    const currentDb = await ensureDB();
    return new Promise((resolve) => {
        const tx = currentDb.transaction('sentEmails', 'readonly');
        const store = tx.objectStore('sentEmails');
        const request = store.get(email);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
    });
}

async function getAllSentEmails() {
    const currentDb = await ensureDB();
    return new Promise((resolve) => {
        const tx = currentDb.transaction('sentEmails', 'readonly');
        const store = tx.objectStore('sentEmails');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
    });
}

async function deleteSentEmail(email) {
    const currentDb = await ensureDB();
    const tx = currentDb.transaction('sentEmails', 'readwrite');
    const store = tx.objectStore('sentEmails');
    await store.delete(email);
}

async function saveProject(project) {
    const currentDb = await ensureDB();
    const tx = currentDb.transaction('projects', 'readwrite');
    const store = tx.objectStore('projects');
    await store.put(project);
}

async function getAllProjects() {
    const currentDb = await ensureDB();
    return new Promise((resolve) => {
        const tx = currentDb.transaction('projects', 'readonly');
        const store = tx.objectStore('projects');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
    });
}

async function deleteProjectFromDB(id) {
    const currentDb = await ensureDB();
    const tx = currentDb.transaction('projects', 'readwrite');
    const store = tx.objectStore('projects');
    await store.delete(id);
}

// Settings & Filters DB Helpers
async function saveToDB(storeName, data) {
    const currentDb = await ensureDB();
    const tx = currentDb.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    await store.put(data);
}

async function getFromDB(storeName, key) {
    const currentDb = await ensureDB();
    return new Promise((resolve) => {
        const tx = currentDb.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
    });
}

// --- Utils ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    toast.innerHTML = `<i class="fas ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showModal(title, message, isConfirm = false, type = 'info') {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-modal');
        const titleEl = document.getElementById('modal-title');
        const messageEl = document.getElementById('modal-message');
        const iconEl = document.getElementById('modal-icon');
        const cancelBtn = document.getElementById('modal-cancel-btn');
        const confirmBtn = document.getElementById('modal-confirm-btn');

        titleEl.textContent = title;
        messageEl.textContent = message;
        cancelBtn.style.display = isConfirm ? 'inline-flex' : 'none';
        confirmBtn.textContent = isConfirm ? 'Confirm' : 'OK';

        // Icon & color by type
        const icons = { danger: ['fa-exclamation-triangle', '#ef4444'], warning: ['fa-exclamation-circle', '#f59e0b'], success: ['fa-check-circle', '#10b981'] };
        const [iconClass, color] = icons[type] || ['fa-info-circle', 'var(--accent-color)'];
        iconEl.className = `fas ${iconClass}`;
        iconEl.style.color = color;

        modal.classList.add('active');

        const cleanup = (result) => {
            modal.classList.remove('active');
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            modal.onclick = null;
            resolve(result);
        };

        confirmBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
        modal.onclick = (e) => { if (e.target === modal) cleanup(false); };
    });
}

function showInputModal(title, message, defaultValue = '') {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-modal');
        const titleEl = document.getElementById('modal-title');
        const messageEl = document.getElementById('modal-message');
        const inputEl = document.getElementById('modal-input');
        const iconEl = document.getElementById('modal-icon');
        const cancelBtn = document.getElementById('modal-cancel-btn');
        const confirmBtn = document.getElementById('modal-confirm-btn');

        titleEl.textContent = title;
        messageEl.textContent = message;
        iconEl.className = 'fas fa-edit';
        iconEl.style.color = 'var(--accent-color)';
        inputEl.value = defaultValue;
        inputEl.style.display = 'block';
        cancelBtn.style.display = 'inline-flex';
        confirmBtn.textContent = 'Save';
        modal.classList.add('active');
        setTimeout(() => inputEl.focus(), 100);

        const cleanup = (result) => {
            modal.classList.remove('active');
            inputEl.style.display = 'none';
            inputEl.onkeydown = null;
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            modal.onclick = null;
            resolve(result);
        };

        confirmBtn.onclick = () => cleanup(inputEl.value.trim() || null);
        cancelBtn.onclick = () => cleanup(null);
        modal.onclick = (e) => { if (e.target === modal) cleanup(null); };
        inputEl.onkeydown = (e) => { if (e.key === 'Enter') cleanup(inputEl.value.trim() || null); };
    });
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function parseDuration(duration) {
    if (duration === 'never') return Infinity;
    if (duration === '0') return 0;
    const match = duration.match(/^(\d+)([dwmy])$/);
    if (!match) return 0;
    const value = parseInt(match[1]);
    const unit = match[2];
    const msMap = {
        'd': 24 * 60 * 60 * 1000,
        'w': 7 * 24 * 60 * 60 * 1000,
        'm': 30 * 24 * 60 * 60 * 1000,
        'y': 365 * 24 * 60 * 60 * 1000
    };
    return value * msMap[unit];
}

function rebuildRegex() {
    if (state.keywordsList.length > 0) {
        CONFIG.keywordRegex = new RegExp(`(${state.keywordsList.join('|')})`, 'i');
    } else {
        CONFIG.keywordRegex = null;
    }
    if (state.tldList.length > 0) {
        CONFIG.eduTldRegex = new RegExp(`(${state.tldList.map(t => t.replace('.', '\\.') + '$').join('|')})`, 'i');
    } else {
        CONFIG.eduTldRegex = null;
    }
}

// --- Tab & UI Switching ---
function switchTab(tabName) {
    document.querySelectorAll('.main-content').forEach(el => el.style.display = 'none');
    document.getElementById(`${tabName}-tab`).style.display = 'flex';

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        if (item.getAttribute('onclick')?.includes(tabName)) {
            item.classList.add('active');
        }
    });

    if (tabName === 'history') renderProjectHistory();
    if (tabName === 'dbexplorer') {
        renderDatabaseView();
        // Sync clear-search button visibility with whatever was left in the input
        const dbSearch = document.getElementById('db-search');
        const clearBtn = document.getElementById('clear-db-search');
        if (clearBtn) clearBtn.style.display = (dbSearch && dbSearch.value) ? 'block' : 'none';
    }
    if (tabName === 'processor' && state.allEmails.length > 0) renderResults();
    if (tabName === 'settings') updateSettingsUI();
    if (tabName === 'domainfilters') updateDomainFiltersUI();
}

// --- Process Logic ---
async function processEmails(preserveView = false) {
    const btn = document.getElementById('process-btn');
    const input = document.getElementById('email-input').value;

    // Use state-based settings
    const batchSize = state.batchSize;
    const cooldown = state.cooldownPeriod;

    if (!input.trim()) {
        showModal('Attention', 'Please paste some text with emails first.', false, 'warning');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    }

    try {
        rebuildRegex();
        const foundEmails = input.match(CONFIG.emailRegex) || [];
        const rawUniqueEmails = [...new Set(foundEmails.map(e => {
            let email = e.toLowerCase().trim();
            // Remove leading/trailing "junk" like hyphens or dots
            email = email.replace(/^[-.]+/, '').replace(/[-.]+$/, '');
            return email;
        }))].filter(e => e.includes('@')); // Ensure it's still a valid structure after cleaning

        state.allEmails = [];
        state.validEmails = [];
        state.blockedEmails = [];

        // OPTIMIZATION: Fetch all sent records once instead of inside the loop
        const allSent = await getAllSentEmails();
        const sentMap = new Map(allSent.map(s => [s.email, s]));

        for (const email of rawUniqueEmails) {
            const domain = email.split('@')[1];
            const isEdu = CONFIG.eduTldRegex ? CONFIG.eduTldRegex.test(domain) : false;
            const hasKeyword = CONFIG.keywordRegex ? CONFIG.keywordRegex.test(domain) : false;
            const inBlockList = state.masterBlockList.includes(domain);
            const isAllowed = state.masterAllowList.includes(domain);

            // Cooldown Check using optimized Map lookup
            const sentRecord = sentMap.get(email);
            const onCooldown = sentRecord && Date.now() < sentRecord.expiresAt;

            // Validity logic: Allow List overrides Keyword/TLD.
            // Emails on cooldown are excluded from valid batches — they've already been sent.
            const hasFilterMatch = isEdu || hasKeyword;
            const isValid = !inBlockList && (isAllowed || !hasFilterMatch) && !onCooldown;

            const emailData = {
                email,
                domain,
                isEdu,
                hasKeyword,
                inBlockList,
                isAllowed,
                onCooldown,
                isSent: !!onCooldown,
                isValid: isValid,
                reason: []
            };

            if (inBlockList) emailData.reason.push('Manual Block');
            if (isEdu && !isAllowed) emailData.reason.push('TLD/EDU');
            if (hasKeyword && !isAllowed) emailData.reason.push('Keyword');
            if (onCooldown) emailData.reason.push(`Sent (${new Date(sentRecord.lastSent).toLocaleDateString()})`);
            if (isAllowed) emailData.reason.push('Allowed Exception');

            if (emailData.isValid) {
                state.validEmails.push(emailData);
            } else {
                state.blockedEmails.push(emailData);
            }
            state.allEmails.push(emailData);
        }

        // Save as Project if new; update totalValid if reloading an existing one
        if (!state.activeProject) {
            state.activeProject = {
                id: 'proj_' + Date.now(),
                name: `Project ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
                rawInput: input,
                emailList: rawUniqueEmails,
                timestamp: Date.now(),
                sentCount: 0,
                totalValid: state.validEmails.length
            };
            await saveProject(state.activeProject);
        } else {
            // Filters may have changed since last open — keep totalValid accurate
            state.activeProject.totalValid = state.validEmails.length;
            await saveProject(state.activeProject);
        }

        createBatches(batchSize);
        updateStats();
        if (!preserveView) state.filteredView = null; // Default to batch view only if not preserving state
        renderResults();

        document.getElementById('post-process-actions').style.display = 'flex';
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-play"></i> Process & Filter';
        }
    }
}

function createBatches(size) {
    state.batches = [];
    for (let i = 0; i < state.validEmails.length; i += size) {
        state.batches.push(state.validEmails.slice(i, i + size));
    }
    state.currentBatchIndex = 0;
}

// --- Statistics & Filtering ---
function updateStats() {
    document.getElementById('stats-total').textContent = state.allEmails.length;
    document.getElementById('stats-valid').textContent = state.validEmails.length;
    document.getElementById('stats-blocked').textContent = state.blockedEmails.length;

    // Count unique new domains — exclude consumer providers & already-blocked domains
    const newBlocks = [...new Set(state.blockedEmails
        .filter(e => (e.isEdu || e.hasKeyword) && !state.masterBlockList.includes(e.domain) && !CONSUMER_DOMAINS.has(e.domain))
        .map(e => e.domain))];
    document.getElementById('stats-new-blocks').textContent = newBlocks.length;
}

function filterResults(type) {
    state.filteredView = type;
    renderResults();
}

// --- Rendering ---
function renderResults() {
    const tbody = document.getElementById('results-body');
    const batchTabsContainer = document.getElementById('batch-tabs');
    const title = document.getElementById('results-title');

    tbody.innerHTML = '';
    batchTabsContainer.innerHTML = '';

    // If viewing batches (default)
    if (!state.filteredView) {
        title.textContent = `Current Batches (${state.batches.length})`;

        state.batches.forEach((batch, i) => {
            const btn = document.createElement('button');
            const isBatchSent = batch.every(item => item.isSent);

            btn.className = `btn btn-secondary ${i === state.currentBatchIndex ? 'active' : ''} ${isBatchSent ? 'batch-sent' : ''}`;
            btn.style.padding = '0.4rem 0.8rem';
            btn.textContent = `Batch ${i + 1}`;
            btn.title = isBatchSent ? "Completed" : "Pending";
            btn.onclick = () => { state.currentBatchIndex = i; renderResults(); };
            batchTabsContainer.appendChild(btn);
        });

        const currentList = state.batches[state.currentBatchIndex] || [];
        if (currentList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-secondary); padding: 3rem;">No valid emails found.</td></tr>`;
            return;
        }

        currentList.forEach(item => {
            const row = document.createElement('tr');
            let actionBtn = '';

            if (item.isSent) {
                actionBtn = `<button class="btn btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;" onclick="markAsUnsent('${item.email}')"><i class="fas fa-undo"></i> Unsent</button>`;
            } else if (item.inBlockList) {
                actionBtn = `<button class="btn btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;" onclick="removeFromBlockList('${item.domain}')"><i class="fas fa-unlock"></i> Unblock</button>`;
            } else if (item.isAllowed) {
                actionBtn = `<button class="btn btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;" onclick="removeFromAllowList('${item.domain}')"><i class="fas fa-times"></i> Disallow</button>`;
            } else if (item.hasKeyword || item.isEdu) {
                actionBtn = `<button class="btn btn-success" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;" onclick="addToAllowList('${item.domain}')"><i class="fas fa-check"></i> Allow</button>`;
            } else {
                actionBtn = `<button class="btn btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;" onclick="addToBlockList('${item.domain}')">Block</button>`;
            }

            row.innerHTML = `
                <td>${item.email}</td>
                <td style="color: var(--text-secondary);">${item.domain}</td>
                <td><span class="badge ${item.isSent ? 'badge-success' : 'badge-secondary'}">${item.isSent ? 'Sent' : 'Pending'}</span></td>
                <td>${actionBtn}</td>
            `;
            tbody.appendChild(row);
        });
    }
    // If viewing filtered list (click on stats)
    else {
        let displayList = [];
        let typeLabel = "";

        switch (state.filteredView) {
            case 'total': displayList = state.allEmails; typeLabel = "All Extracted"; break;
            case 'valid': displayList = state.validEmails; typeLabel = "Valid Unique"; break;
            case 'blocked': displayList = state.blockedEmails; typeLabel = "Blocked Emails"; break;
            case 'new': {
                // Exclude consumer providers + deduplicate: 1 email per unique domain
                const seenDomains = new Set();
                displayList = state.blockedEmails.filter(e => {
                    if (!((e.isEdu || e.hasKeyword) && !state.masterBlockList.includes(e.domain))) return false;
                    if (CONSUMER_DOMAINS.has(e.domain)) return false;
                    if (seenDomains.has(e.domain)) return false;
                    seenDomains.add(e.domain);
                    return true;
                });
                typeLabel = "New Domains Detected";
                break;
            }
        }

        title.textContent = `${typeLabel} (${displayList.length})`;
        const backBtn = document.createElement('button');
        backBtn.className = "btn btn-secondary";
        backBtn.style.padding = "0.4rem 0.8rem";
        backBtn.innerHTML = "<i class='fas fa-arrow-left'></i> Back to Batches";
        backBtn.onclick = () => { state.filteredView = null; renderResults(); };
        batchTabsContainer.appendChild(backBtn);

        displayList.forEach(item => {
            const row = document.createElement('tr');
            const statusBadge = item.isValid ?
                '<span class="badge badge-success">Valid</span>' :
                `<span class="badge badge-danger">${item.reason.join(', ')}</span>`;

            let actionBtn = '';
            if (item.inBlockList) {
                actionBtn = `<button class="btn btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;" onclick="removeFromBlockList('${item.domain}')"><i class="fas fa-unlock"></i> Unblock</button>`;
            } else if (item.isAllowed) {
                actionBtn = `<button class="btn btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;" onclick="removeFromAllowList('${item.domain}')"><i class="fas fa-times"></i> Disallow</button>`;
            } else if (item.hasKeyword || item.isEdu) {
                actionBtn = `<button class="btn btn-success" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;" onclick="addToAllowList('${item.domain}')"><i class="fas fa-check"></i> Allow</button>`;
            } else {
                actionBtn = `<button class="btn btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;" onclick="addToBlockList('${item.domain}')">Block</button>`;
            }

            row.innerHTML = `
                <td>${item.email}</td>
                <td>${item.domain}</td>
                <td>${statusBadge}</td>
                <td>${actionBtn}</td>
            `;
            tbody.appendChild(row);
        });
    }
}

// --- History Management ---
async function renderProjectHistory() {
    const container = document.getElementById('projects-container');
    container.innerHTML = '';

    const projects = await getAllProjects();
    if (projects.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary);">No projects saved yet.</p>';
        return;
    }

    projects.sort((a, b) => b.timestamp - a.timestamp).forEach(proj => {
        const card = document.createElement('div');
        card.className = 'project-card';
        const sentCount = proj.sentCount || 0;
        const totalValid = proj.totalValid || 1;
        const percent = Math.min(100, Math.round((sentCount / totalValid) * 100));

        const safeName = escapeHtml(proj.name);
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                <h3 style="font-size: 1.1rem; flex: 1; cursor: pointer;" onclick="renameProject('${proj.id}', '${escapeHtml(proj.name)}')">${safeName} <i class="fas fa-edit" style="font-size: 0.8rem; opacity: 0.5;"></i></h3>
                <span class="badge badge-info">${percent}% Sent</span>
            </div>
            <p style="color: var(--text-secondary); font-size: 0.85rem;">Created: ${new Date(proj.timestamp).toLocaleDateString()}</p>
            <div class="progress-container">
                <div class="progress-bar" style="width: ${percent}%"></div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 1rem;">
                <span style="font-size: 0.8rem; color: var(--text-secondary);">${sentCount} / ${totalValid} Emails</span>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn btn-secondary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" onclick="loadProject('${proj.id}')">Open</button>
                    <button class="btn btn-danger-outline" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; border-color: rgba(248,81,73,0.3);" onclick="deleteProject('${proj.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

async function renameProject(id, oldName) {
    const newName = await showInputModal('Rename Project', 'Enter a new name for this project:', oldName);
    if (!newName || newName === oldName) return;

    const projects = await getAllProjects();
    const proj = projects.find(p => p.id === id);
    if (proj) {
        proj.name = newName;
        await saveProject(proj);
        renderProjectHistory();
        showToast('Project renamed.');
    }
}

async function deleteProject(id) {
    const confirmed = await showModal('Delete Project', 'Are you sure you want to delete this project? Data in history will be lost.', true, 'danger');
    if (!confirmed) return;
    await deleteProjectFromDB(id);
    if (state.activeProject && state.activeProject.id === id) state.activeProject = null;
    renderProjectHistory();
    showToast('Project deleted.', 'danger');
}

async function loadProject(id) {
    const projects = await getAllProjects();
    const proj = projects.find(p => p.id === id);
    if (!proj) return;

    // Reset state to avoid stale data when loading a new project
    state.batches = [];
    state.currentBatchIndex = 0;
    state.allEmails = [];
    state.validEmails = [];
    state.blockedEmails = [];
    state.activeProject = proj;
    document.getElementById('email-input').value = proj.rawInput;

    // Update active project UI info
    document.getElementById('active-project-info').style.display = 'block';
    document.getElementById('project-date').textContent = `Created ${new Date(proj.timestamp).toLocaleDateString()}`;

    switchTab('processor');
    processEmails();
}

// --- Actions ---
async function markBatchAsSent() {
    const currentBatch = state.batches[state.currentBatchIndex];
    if (!currentBatch || currentBatch.length === 0) return;

    // Save to Sent History
    for (const item of currentBatch) {
        if (!item.isSent) {
            await saveSentEmail(item.email, state.cooldownPeriod);
            item.isSent = true;
            if (state.activeProject) state.activeProject.sentCount++;
        }
    }

    // Save project progress
    if (state.activeProject) {
        await saveProject(state.activeProject);
    }

    showToast(`Batch ${state.currentBatchIndex + 1} marked as sent!`);
    renderResults();
}

async function markBatchAsUnsent() {
    const currentBatch = state.batches[state.currentBatchIndex];
    if (!currentBatch || currentBatch.length === 0) return;

    const confirmed = await showModal('Undo Batch', `Mark all ${currentBatch.length} emails in this batch as unsent?`, true, 'warning');
    if (!confirmed) return;

    for (const item of currentBatch) {
        if (item.isSent) {
            await deleteSentEmail(item.email);
            item.isSent = false;
        }
    }

    if (state.activeProject) {
        state.activeProject.sentCount = state.allEmails.filter(e => e.isSent).length;
        await saveProject(state.activeProject);
    }

    showToast(`Batch ${state.currentBatchIndex + 1} marked as unsent.`);
    renderResults();
}

async function markAsUnsent(email) {
    const confirmed = await showModal('Unmark Email', `Mark ${email} as unsent?`, true, 'info');
    if (!confirmed) return;

    await deleteSentEmail(email);

    // Update local state
    state.batches.forEach(batch => {
        batch.forEach(item => { if (item.email === email) item.isSent = false; });
    });
    state.allEmails.forEach(item => { if (item.email === email) item.isSent = false; });

    if (state.activeProject) {
        state.activeProject.sentCount = state.allEmails.filter(e => e.isSent).length;
        await saveProject(state.activeProject);
    }

    // Refresh UI
    updateStats();
    renderResults();

    // If database view is active, refresh it with a clean cache
    if (document.getElementById('dbexplorer-tab').style.display !== 'none') {
        fullDbCache = [];
        renderDatabaseView();
    }
}

function copyCurrentBatch() {
    const currentBatch = state.batches[state.currentBatchIndex];
    if (!currentBatch || currentBatch.length === 0) return;

    const emailString = currentBatch.map(e => e.email).join('\n');
    navigator.clipboard.writeText(emailString).then(() => {
        const btn = document.querySelector('button[onclick="copyCurrentBatch()"]');
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        setTimeout(() => btn.innerHTML = originalHtml, 2000);
    }).catch(() => showToast('Copy failed. Please copy manually.', 'danger'));
}

// --- Smart Extraction Helper ---
function smartCleanDomain(input) {
    if (!input) return null;
    let d = input.trim().toLowerCase();

    // 1. Handle emails (take after @)
    if (d.includes('@')) {
        d = d.split('@')[1];
    }

    // 2. Handle URLs
    try {
        if (!d.startsWith('http')) {
            d = 'http://' + d; // Temp add protocol for URL parser
        }
        const url = new URL(d);
        d = url.hostname;
    } catch (e) {
        // Fallback for cases where URL parser fails: strip protocols manually
        d = d.replace(/^https?:\/\//, '').split('/')[0].split('?')[0];
    }

    // 3. Remove 'www.'
    d = d.replace(/^www\./, '');

    return d || null;
}

// --- Data Migration & Initialization ---
async function migrateFromLocalStorage() {
    // Run migration only once to avoid overwriting good IndexedDB data with stale localStorage
    const alreadyMigrated = await getFromDB('settings', 'migrationDone');
    if (alreadyMigrated) return false;

    const migrationKeys = ['masterBlockList', 'masterAllowList', 'keywordsList', 'tldList'];
    let migrated = false;

    for (const key of migrationKeys) {
        const data = localStorage.getItem(key);
        if (data) {
            const parsed = JSON.parse(data);
            if (key === 'masterBlockList' || key === 'masterAllowList') {
                await saveToDB('filters', { type: key, list: parsed });
            } else {
                await saveToDB('filters', { type: key, list: (parsed.length > 0 ? parsed : DEFAULTS[key === 'keywordsList' ? 'keywords' : 'tlds']) });
            }
            migrated = true;
            localStorage.removeItem(key);
        }
    }

    // Settings migration
    const oldBatch = localStorage.getItem('batchSize');
    const oldCooldown = localStorage.getItem('cooldownPeriod');
    if (oldBatch) { await saveToDB('settings', { key: 'batchSize', value: parseInt(oldBatch) }); localStorage.removeItem('batchSize'); }
    if (oldCooldown) { await saveToDB('settings', { key: 'cooldownPeriod', value: oldCooldown }); localStorage.removeItem('cooldownPeriod'); }

    // Mark migration as done so it never runs again
    await saveToDB('settings', { key: 'migrationDone', value: true });
    return migrated;
}

async function initApp() {
    await initDB();

    // Try to migrate if first time
    const migrationDone = await migrateFromLocalStorage();

    // Load Filters
    const blockList = await getFromDB('filters', 'masterBlockList');
    const allowList = await getFromDB('filters', 'masterAllowList');
    const keywordsList = await getFromDB('filters', 'keywordsList');
    const tldList = await getFromDB('filters', 'tldList');

    if (blockList) state.masterBlockList = blockList.list;
    if (allowList) state.masterAllowList = allowList.list;
    if (keywordsList) state.keywordsList = keywordsList.list;
    if (tldList) state.tldList = tldList.list;

    // Load Settings
    const sBatch = await getFromDB('settings', 'batchSize');
    const sCooldown = await getFromDB('settings', 'cooldownPeriod');

    if (sBatch) state.batchSize = sBatch.value;
    if (sCooldown) state.cooldownPeriod = sCooldown.value;

    // Sync UI
    document.getElementById('batch-size').value = state.batchSize;
    document.getElementById('cooldown-period').value = state.cooldownPeriod;

    // Hooks for UI changes
    document.getElementById('batch-size').onchange = (e) => {
        state.batchSize = parseInt(e.target.value) || 25;
        saveToDB('settings', { key: 'batchSize', value: state.batchSize });
    };
    document.getElementById('cooldown-period').onchange = (e) => {
        state.cooldownPeriod = e.target.value;
        saveToDB('settings', { key: 'cooldownPeriod', value: state.cooldownPeriod });
    };

    rebuildRegex();
    updateDomainFiltersUI();
    updateSettingsUI();
    renderProjectHistory();
}

// Reuse existing keyword/TLD/Blocklist management functions with small adjustments
async function addToBlockList(domain) {
    const input = document.getElementById('blocklist-input');
    const rawValue = domain || (input ? input.value : '');

    // Split by comma, space, or newline
    const entries = rawValue.split(/[\s,\n]+/).filter(e => e.trim());

    let addedCount = 0;
    entries.forEach(entry => {
        const cleaned = smartCleanDomain(entry);
        if (cleaned && !state.masterBlockList.includes(cleaned)) {
            state.masterBlockList.push(cleaned);
            addedCount++;
        }
    });

    if (addedCount > 0) {
        await saveToDB('filters', { type: 'masterBlockList', list: state.masterBlockList });
        updateDomainFiltersUI();
        if (state.allEmails.length > 0) await processEmails(true);
    }

    if (input && !domain) input.value = '';
}



async function removeFromBlockList(domain) {
    state.masterBlockList = state.masterBlockList.filter(d => d !== domain);
    await saveToDB('filters', { type: 'masterBlockList', list: state.masterBlockList });
    updateDomainFiltersUI();
    if (state.allEmails.length > 0) await processEmails(true);
}

// Master Allow List Management
async function addToAllowList(domain) {
    const input = document.getElementById('allowlist-input');
    const rawValue = domain || (input ? input.value : '');

    const entries = rawValue.split(/[\s,\n]+/).filter(e => e.trim());

    let addedCount = 0;
    entries.forEach(entry => {
        const cleaned = smartCleanDomain(entry);
        if (cleaned && !state.masterAllowList.includes(cleaned)) {
            state.masterAllowList.push(cleaned);
            addedCount++;
        }
    });

    if (addedCount > 0) {
        await saveToDB('filters', { type: 'masterAllowList', list: state.masterAllowList });
        updateDomainFiltersUI();
        if (state.allEmails.length > 0) await processEmails(true);
    }

    if (input && !domain) input.value = '';
}

async function removeFromAllowList(domain) {
    state.masterAllowList = state.masterAllowList.filter(d => d !== domain);
    await saveToDB('filters', { type: 'masterAllowList', list: state.masterAllowList });
    updateDomainFiltersUI();
    if (state.allEmails.length > 0) await processEmails(true);
}

function updateDomainFiltersUI() {
    const blockContainer = document.getElementById('blocked-domains-tags');
    const allowContainer = document.getElementById('allowed-domains-tags');

    if (blockContainer) {
        blockContainer.innerHTML = state.masterBlockList.map(domain => `
            <div class="badge badge-danger" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.8rem;">
                ${escapeHtml(domain)}
                <i class="fas fa-times" style="cursor: pointer;" onclick="removeFromBlockList('${escapeHtml(domain)}')"></i>
            </div>
        `).join('');
    }

    if (allowContainer) {
        allowContainer.innerHTML = state.masterAllowList.map(domain => `
            <div class="badge badge-success" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.8rem;">
                ${escapeHtml(domain)}
                <i class="fas fa-times" style="cursor: pointer;" onclick="removeFromAllowList('${escapeHtml(domain)}')"></i>
            </div>
        `).join('');
    }
}

// --- Import/Export Lists ---
function exportLists() {
    const data = {
        block: state.masterBlockList,
        allow: state.masterAllowList,
        keywords: state.keywordsList,
        tlds: state.tldList,
        version: '1.0',
        timestamp: Date.now()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filename = `email_master_filters_${new Date().toISOString().split('T')[0]}.json`;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported as ${filename}`);
}

async function importLists(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.block) state.masterBlockList = data.block;
            if (data.allow) state.masterAllowList = data.allow;
            if (data.keywords) state.keywordsList = data.keywords;
            if (data.tlds) state.tldList = data.tlds;

            await saveToDB('filters', { type: 'masterBlockList', list: state.masterBlockList });
            await saveToDB('filters', { type: 'masterAllowList', list: state.masterAllowList });
            await saveToDB('filters', { type: 'keywordsList', list: state.keywordsList });
            await saveToDB('filters', { type: 'tldList', list: state.tldList });

            updateDomainFiltersUI();
            updateSettingsUI();
            rebuildRegex();
            showToast('Filters imported successfully.');
            input.value = ''; // Reset input
        } catch (err) {
            showModal('Import Error', 'Invalid filter file format. Please use a valid JSON export.', false, 'danger');
            console.error(err);
        }
    };
    reader.readAsText(file);
}

// Settings UI adjustments
function updateSettingsUI() {
    const kwTags = document.getElementById('keywords-tags');
    const tldTags = document.getElementById('tlds-tags');
    const kwLibrary = document.getElementById('keywords-library');
    const tldLibrary = document.getElementById('tlds-library');

    if (kwTags) kwTags.innerHTML = state.keywordsList.map(kw => `
        <div class="badge badge-info" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.7rem;">
            ${escapeHtml(kw)} <i class="fas fa-times" style="cursor: pointer;" onclick="removeKeyword('${escapeHtml(kw)}')"></i>
        </div>`).join('');

    if (kwLibrary) kwLibrary.innerHTML = DEFAULTS.keywords.filter(kw => !state.keywordsList.includes(kw))
        .map(kw => `<div class="badge badge-secondary" style="cursor: pointer; padding: 0.4rem 0.7rem;" onclick="addKeywordFromLibrary('${escapeHtml(kw)}')">+ ${escapeHtml(kw)}</div>`).join('');

    if (tldTags) tldTags.innerHTML = state.tldList.map(tld => `
        <div class="badge badge-info" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.7rem;">
            ${escapeHtml(tld)} <i class="fas fa-times" style="cursor: pointer;" onclick="removeTLD('${escapeHtml(tld)}')"></i>
        </div>`).join('');

    if (tldLibrary) tldLibrary.innerHTML = DEFAULTS.tlds.filter(tld => !state.tldList.includes(tld))
        .map(tld => `<div class="badge badge-secondary" style="cursor: pointer; padding: 0.4rem 0.7rem;" onclick="addTLDFromLibrary('${escapeHtml(tld)}')">+ ${escapeHtml(tld)}</div>`).join('');
}

async function addKeyword() {
    const input = document.getElementById('keyword-input');
    const val = input.value.trim().toLowerCase();
    if (val && !state.keywordsList.includes(val)) {
        state.keywordsList.push(val);
        await saveToDB('filters', { type: 'keywordsList', list: state.keywordsList });
        input.value = ''; updateSettingsUI(); rebuildRegex();
        showToast('Filter saved.');
    }
}
async function removeKeyword(kw) {
    state.keywordsList = state.keywordsList.filter(k => k !== kw);
    await saveToDB('filters', { type: 'keywordsList', list: state.keywordsList });
    updateSettingsUI(); rebuildRegex();
    showToast('Filter saved.');
}
async function addKeywordFromLibrary(kw) {
    if (state.keywordsList.includes(kw)) return;
    state.keywordsList.push(kw);
    await saveToDB('filters', { type: 'keywordsList', list: state.keywordsList });
    updateSettingsUI(); rebuildRegex();
    showToast('Filter saved.');
}
async function addTLD() {
    let val = document.getElementById('tld-input').value.trim().toLowerCase();
    if (val) {
        if (!val.startsWith('.')) val = '.' + val;
        state.tldList.push(val);
        await saveToDB('filters', { type: 'tldList', list: state.tldList });
        document.getElementById('tld-input').value = ''; updateSettingsUI(); rebuildRegex();
        showToast('Filter saved.');
    }
}
async function removeTLD(tld) {
    state.tldList = state.tldList.filter(t => t !== tld);
    await saveToDB('filters', { type: 'tldList', list: state.tldList });
    updateSettingsUI(); rebuildRegex();
    showToast('Filter saved.');
}
async function addTLDFromLibrary(tld) {
    state.tldList.push(tld);
    await saveToDB('filters', { type: 'tldList', list: state.tldList });
    updateSettingsUI(); rebuildRegex();
    showToast('Filter saved.');
}

async function resetToDefaults() {
    const confirmed = await showModal('Reset Defaults', 'Reset all keywords and TLDs to factory defaults?', true, 'warning');
    if (confirmed) {
        state.keywordsList = [...DEFAULTS.keywords];
        state.tldList = [...DEFAULTS.tlds];
        await saveToDB('filters', { type: 'keywordsList', list: state.keywordsList });
        await saveToDB('filters', { type: 'tldList', list: state.tldList });
        updateSettingsUI(); rebuildRegex();
    }
}

async function clearAllData() {
    const confirmed = await showModal('FACTORY RESET', 'CLEAR ALL DATA including history and block lists? This cannot be undone.', true, 'danger');
    if (confirmed) {
        indexedDB.deleteDatabase(dbName);
        localStorage.clear();
        location.reload();
    }
}

// --- Database Explorer & Export ---
const DB_PAGE_SIZE = 25;
let fullDbCache = [];

async function renderDatabaseView() {
    const tbody = document.getElementById('db-tbody');
    const stats = document.getElementById('db-stats');
    tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 2rem;">Compiling comprehensive database...</td></tr>';

    const projects = await getAllProjects();
    const sentHistory = await getAllSentEmails();
    const dbMap = new Map();

    // 1. Initialize from sent history
    sentHistory.forEach(item => {
        dbMap.set(item.email, {
            email: item.email,
            lastSent: item.lastSent,
            expiresAt: item.expiresAt
        });
    });

    // 2. Add all unique emails from projects
    projects.forEach(proj => {
        // Use cached emailList if available; only fall back to regex for old projects
        const found = proj.emailList || proj.rawInput.match(CONFIG.emailRegex) || [];
        found.forEach(email => {
            const e = email.toLowerCase().trim();
            if (!dbMap.has(e)) {
                dbMap.set(e, {
                    email: e,
                    lastSent: null,
                    expiresAt: 0
                });
            }
        });
    });

    fullDbCache = Array.from(dbMap.values()).sort((a, b) => a.email.localeCompare(b.email));

    // Apply existing search query if any
    const query = document.getElementById('db-search').value.toLowerCase().trim();
    if (query) {
        state.dbFilteredEmails = fullDbCache.filter(e =>
            e.email.toLowerCase().includes(query) ||
            (e.email.split('@')[1] && e.email.split('@')[1].toLowerCase().includes(query))
        );
    } else {
        state.dbFilteredEmails = [...fullDbCache];
    }

    state.dbCurrentPage = 1;
    stats.textContent = `Total: ${fullDbCache.length} Emails`;
    displayDatabaseResults();
}

function displayDatabaseResults() {
    const tbody = document.getElementById('db-tbody');
    const pageInfo = document.getElementById('db-page-info');
    const prevBtn = document.getElementById('db-prev-btn');
    const nextBtn = document.getElementById('db-next-btn');

    tbody.innerHTML = '';

    const totalPages = Math.ceil(state.dbFilteredEmails.length / DB_PAGE_SIZE) || 1;
    if (state.dbCurrentPage > totalPages) state.dbCurrentPage = totalPages;
    if (state.dbCurrentPage < 1) state.dbCurrentPage = 1;

    const start = (state.dbCurrentPage - 1) * DB_PAGE_SIZE;
    const end = start + DB_PAGE_SIZE;
    const pageData = state.dbFilteredEmails.slice(start, end);

    if (pageData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No emails found.</td></tr>';
    } else {
        pageData.forEach(item => {
            const row = document.createElement('tr');
            const lastSentDate = item.lastSent ? new Date(item.lastSent).toLocaleDateString() : 'Never';
            const isExpired = item.lastSent && item.expiresAt < Number.MAX_SAFE_INTEGER && Date.now() > item.expiresAt;
            const statusLabel = !item.lastSent ? 'New' : (isExpired ? 'Cooldown Over' : 'On Cooldown');
            const badgeClass = !item.lastSent ? 'badge-info' : (isExpired ? 'badge-secondary' : 'badge-success');

            const actionBtn = item.lastSent
                ? `<button class="btn btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;" onclick="markAsUnsent('${item.email}')"><i class="fas fa-undo"></i> Unmark</button>`
                : `<span style="color: var(--text-secondary); font-size: 0.75rem;">-</span>`;

            row.innerHTML = `
                <td>${item.email}</td>
                <td>${lastSentDate}</td>
                <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
                <td>${actionBtn}</td>
            `;
            tbody.appendChild(row);
        });
    }

    pageInfo.textContent = `Page ${state.dbCurrentPage} of ${totalPages}`;
    prevBtn.disabled = state.dbCurrentPage <= 1;
    nextBtn.disabled = state.dbCurrentPage >= totalPages;
}

function changeDatabasePage(dir) {
    state.dbCurrentPage += dir;
    displayDatabaseResults();
    // Scroll to top of table
    const container = document.getElementById('db-tbody').closest('.table-container');
    if (container) container.scrollTop = 0;
}

function clearDatabaseSearch() {
    const input = document.getElementById('db-search');
    input.value = '';
    document.getElementById('clear-db-search').style.display = 'none';
    filterDatabaseView();
}

const filterDatabaseView = debounce(() => {
    const input = document.getElementById('db-search');
    const query = input.value.toLowerCase().trim();
    const clearBtn = document.getElementById('clear-db-search');

    if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';

    state.dbFilteredEmails = fullDbCache.filter(e =>
        e.email.toLowerCase().includes(query) ||
        (e.email.split('@')[1] && e.email.split('@')[1].toLowerCase().includes(query))
    );
    state.dbCurrentPage = 1;
    displayDatabaseResults();
}, 250);

function exportDatabase(type) {
    if (fullDbCache.length === 0) {
        showModal('Nothing to Export', 'The database is empty. Process some emails first.', false, 'warning');
        return;
    }

    let content = '';
    let filename = `email_database_full_${new Date().toISOString().split('T')[0]}`;

    if (type === 'csv') {
        content = 'Email,Last Sent,Status\n';
        fullDbCache.forEach(e => {
            const lastSent = e.lastSent ? new Date(e.lastSent).toLocaleDateString() : 'Never';
            const status = !e.lastSent ? 'New' : ((e.expiresAt < Number.MAX_SAFE_INTEGER && Date.now() > e.expiresAt) ? 'Cooldown Over' : 'On Cooldown');
            content += `${e.email},${lastSent},${status}\n`;
        });
        filename += '.csv';
    } else {
        content = fullDbCache.map(e => e.email).join('\n');
        filename += '.txt';
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --- Initialization ---
initApp();
