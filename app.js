// --- Constants & Defaults ---
const DEFAULTS = {
    keywords: ["consultancy", "manpower", "recruitment", "recruit", "agency", "recruiting", "placement", "hire", "talent", "job", "staff", "people", "jobs", "search", "human"],
    tlds: [".edu", ".ac.in", ".edu.in", ".education"]
};

// --- Global State ---
let state = {
    allEmails: [],
    validEmails: [],
    blockedEmails: [],
    filteredView: null, // 'total', 'valid', 'blocked', 'new'
    masterBlockList: JSON.parse(localStorage.getItem('masterBlockList')) || [],
    masterAllowList: JSON.parse(localStorage.getItem('masterAllowList')) || [],
    keywordsList: JSON.parse(localStorage.getItem('keywordsList')) || [...DEFAULTS.keywords],
    tldList: JSON.parse(localStorage.getItem('tldList')) || [...DEFAULTS.tlds],
    batches: [],
    currentBatchIndex: 0,
    activeProject: null,
    dbCurrentPage: 1,
    dbFilteredEmails: []
};

let CONFIG = {
    emailRegex: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
    keywordRegex: null,
    eduTldRegex: null
};

// --- Native IndexedDB Manager ---
const dbName = "EmailMasterDB";
const dbVersion = 1;
let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, dbVersion);

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('sentEmails')) {
                db.createObjectStore('sentEmails', { keyPath: 'email' });
            }
            if (!db.objectStoreNames.contains('projects')) {
                db.createObjectStore('projects', { keyPath: 'id' });
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
async function saveSentEmail(email, cooldown) {
    const expiresAt = cooldown === 'never' ? Infinity : Date.now() + parseDuration(cooldown);
    const tx = db.transaction('sentEmails', 'readwrite');
    const store = tx.objectStore('sentEmails');
    await store.put({ email, lastSent: Date.now(), expiresAt });
}

async function getSentStatus(email) {
    return new Promise((resolve) => {
        const tx = db.transaction('sentEmails', 'readonly');
        const store = tx.objectStore('sentEmails');
        const request = store.get(email);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
    });
}

async function getAllSentEmails() {
    return new Promise((resolve) => {
        const tx = db.transaction('sentEmails', 'readonly');
        const store = tx.objectStore('sentEmails');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
    });
}

async function deleteSentEmail(email) {
    const tx = db.transaction('sentEmails', 'readwrite');
    const store = tx.objectStore('sentEmails');
    await store.delete(email);
}

async function saveProject(project) {
    const tx = db.transaction('projects', 'readwrite');
    const store = tx.objectStore('projects');
    await store.put(project);
}

async function getAllProjects() {
    return new Promise((resolve) => {
        const tx = db.transaction('projects', 'readonly');
        const store = tx.objectStore('projects');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
    });
}

// --- Utils ---
function parseDuration(duration) {
    if (duration === 'never' || duration === 'never') return Infinity;
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
    const kwPattern = state.keywordsList.join('|');
    CONFIG.keywordRegex = new RegExp(`(${kwPattern})`, 'i');
    const tldPattern = state.tldList.map(t => t.replace('.', '\\.') + '$').join('|');
    CONFIG.eduTldRegex = new RegExp(`(${tldPattern})`, 'i');
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
    if (tabName === 'dbexplorer') renderDatabaseView();
    if (tabName === 'processor') renderResults();
}

// --- Process Logic ---
async function processEmails(preserveView = false) {
    const btn = document.getElementById('process-btn');
    const input = document.getElementById('email-input').value;
    const batchSize = parseInt(document.getElementById('batch-size').value) || 25;
    const cooldown = document.getElementById('cooldown-period').value;

    if (!input.trim()) {
        alert('Please paste some text with emails first.');
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
            const isEdu = CONFIG.eduTldRegex.test(domain);
            const hasKeyword = CONFIG.keywordRegex.test(domain);
            const inBlockList = state.masterBlockList.includes(domain);
            const isAllowed = state.masterAllowList.includes(domain);

            // Cooldown Check using optimized Map lookup
            const sentRecord = sentMap.get(email);
            const onCooldown = sentRecord && Date.now() < sentRecord.expiresAt;

            // Validity logic: Allow List overrides Keyword/TLD. 
            // Sent status (onCooldown) now invalidates an email to move it from active batches to the Blocked section.
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
                isSent: !!sentRecord,
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

        // Save as Project if new
        if (!state.activeProject) {
            state.activeProject = {
                id: 'proj_' + Date.now(),
                name: `Project ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
                rawInput: input,
                timestamp: Date.now(),
                sentCount: 0,
                totalValid: state.validEmails.length
            };
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

    const newBlocks = [...new Set(state.blockedEmails
        .filter(e => (e.isEdu || e.hasKeyword) && !state.masterBlockList.includes(e.domain))
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
            case 'new':
                displayList = state.blockedEmails.filter(e => (e.isEdu || e.hasKeyword) && !state.masterBlockList.includes(e.domain));
                typeLabel = "New Domains Detected";
                break;
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
        const percent = Math.round((proj.sentCount / proj.totalValid) * 100) || 0;

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                <h3 style="font-size: 1.1rem;">${proj.name}</h3>
                <span class="badge badge-info">${percent}% Sent</span>
            </div>
            <p style="color: var(--text-secondary); font-size: 0.85rem;">Created: ${new Date(proj.timestamp).toLocaleDateString()}</p>
            <div class="progress-container">
                <div class="progress-bar" style="width: ${percent}%"></div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 1rem;">
                <span style="font-size: 0.8rem; color: var(--text-secondary);">${proj.sentCount} / ${proj.totalValid} Emails</span>
                <button class="btn btn-secondary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" onclick="loadProject('${proj.id}')">Open project</button>
            </div>
        `;
        container.appendChild(card);
    });
}

async function loadProject(id) {
    const projects = await getAllProjects();
    const proj = projects.find(p => p.id === id);
    if (!proj) return;

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

    const cooldown = document.getElementById('cooldown-period').value;

    // Save to Sent History
    for (const item of currentBatch) {
        if (!item.isSent) {
            await saveSentEmail(item.email, cooldown);
            item.isSent = true;
            if (state.activeProject) state.activeProject.sentCount++;
        }
    }

    // Save project progress
    if (state.activeProject) {
        await saveProject(state.activeProject);
    }

    // Transition UI
    const btn = document.getElementById('mark-sent-btn');
    btn.innerHTML = '<i class="fas fa-check"></i> Batch Sent!';
    setTimeout(() => {
        btn.innerHTML = '<i class="fas fa-check-double"></i> Mark as Sent';
    }, 1500);
}

async function markAsUnsent(email) {
    if (!confirm(`Mark ${email} as unsent?`)) return;

    await deleteSentEmail(email);

    // Update local state
    state.batches.forEach(batch => {
        batch.forEach(item => {
            if (item.email === email) {
                item.isSent = false;
                if (state.activeProject) state.activeProject.sentCount = Math.max(0, state.activeProject.sentCount - 1);
            }
        });
    });

    state.allEmails.forEach(item => {
        if (item.email === email) {
            item.isSent = false;
        }
    });

    if (state.activeProject) {
        await saveProject(state.activeProject);
    }

    // Refresh UI
    updateStats();
    renderResults();

    // If database view is active, refresh it
    if (document.getElementById('dbexplorer-tab').style.display !== 'none') {
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
    });
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

// Reuse existing keyword/TLD/Blocklist management functions with small adjustments
function addToBlockList(domain) {
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
        localStorage.setItem('masterBlockList', JSON.stringify(state.masterBlockList));
        updateDomainFiltersUI();
        if (state.allEmails.length > 0) processEmails(true);
    }

    if (input && !domain) input.value = '';
}



function removeFromBlockList(domain) {
    state.masterBlockList = state.masterBlockList.filter(d => d !== domain);
    localStorage.setItem('masterBlockList', JSON.stringify(state.masterBlockList));
    updateDomainFiltersUI();
    if (state.allEmails.length > 0) processEmails(true);
}

// Master Allow List Management
function addToAllowList(domain) {
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
        localStorage.setItem('masterAllowList', JSON.stringify(state.masterAllowList));
        updateDomainFiltersUI();
        if (state.allEmails.length > 0) processEmails(true);
    }

    if (input && !domain) input.value = '';
}

function removeFromAllowList(domain) {
    state.masterAllowList = state.masterAllowList.filter(d => d !== domain);
    localStorage.setItem('masterAllowList', JSON.stringify(state.masterAllowList));
    updateDomainFiltersUI();
    if (state.allEmails.length > 0) processEmails(true);
}

function updateDomainFiltersUI() {
    const blockContainer = document.getElementById('blocked-domains-tags');
    const allowContainer = document.getElementById('allowed-domains-tags');

    if (blockContainer) {
        blockContainer.innerHTML = state.masterBlockList.map(domain => `
            <div class="badge badge-danger" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.8rem;">
                ${domain}
                <i class="fas fa-times" style="cursor: pointer;" onclick="removeFromBlockList('${domain}')"></i>
            </div>
        `).join('');
    }

    if (allowContainer) {
        allowContainer.innerHTML = state.masterAllowList.map(domain => `
            <div class="badge badge-success" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.8rem;">
                ${domain}
                <i class="fas fa-times" style="cursor: pointer;" onclick="removeFromAllowList('${domain}')"></i>
            </div>
        `).join('');
    }
}

// Settings UI adjustments
function updateSettingsUI() {
    const kwTags = document.getElementById('keywords-tags');
    const tldTags = document.getElementById('tlds-tags');
    const kwLibrary = document.getElementById('keywords-library');
    const tldLibrary = document.getElementById('tlds-library');

    if (kwTags) kwTags.innerHTML = state.keywordsList.map(kw => `
        <div class="badge badge-info" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.7rem;">
            ${kw} <i class="fas fa-times" style="cursor: pointer;" onclick="removeKeyword('${kw}')"></i>
        </div>`).join('');

    if (kwLibrary) kwLibrary.innerHTML = DEFAULTS.keywords.filter(kw => !state.keywordsList.includes(kw))
        .map(kw => `<div class="badge badge-secondary" style="cursor: pointer; padding: 0.4rem 0.7rem;" onclick="addKeywordFromLibrary('${kw}')">+ ${kw}</div>`).join('');

    if (tldTags) tldTags.innerHTML = state.tldList.map(tld => `
        <div class="badge badge-info" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.7rem;">
            ${tld} <i class="fas fa-times" style="cursor: pointer;" onclick="removeTLD('${tld}')"></i>
        </div>`).join('');

    if (tldLibrary) tldLibrary.innerHTML = DEFAULTS.tlds.filter(tld => !state.tldList.includes(tld))
        .map(tld => `<div class="badge badge-secondary" style="cursor: pointer; padding: 0.4rem 0.7rem;" onclick="addTLDFromLibrary('${tld}')">+ ${tld}</div>`).join('');
}

function addKeyword() {
    const input = document.getElementById('keyword-input');
    const val = input.value.trim().toLowerCase();
    if (val && !state.keywordsList.includes(val)) {
        state.keywordsList.push(val);
        localStorage.setItem('keywordsList', JSON.stringify(state.keywordsList));
        input.value = ''; updateSettingsUI(); rebuildRegex();
    }
}
function removeKeyword(kw) {
    state.keywordsList = state.keywordsList.filter(k => k !== kw);
    localStorage.setItem('keywordsList', JSON.stringify(state.keywordsList));
    updateSettingsUI(); rebuildRegex();
}
function addKeywordFromLibrary(kw) {
    state.keywordsList.push(kw);
    localStorage.setItem('keywordsList', JSON.stringify(state.keywordsList));
    updateSettingsUI(); rebuildRegex();
}
function addTLD() {
    let val = document.getElementById('tld-input').value.trim().toLowerCase();
    if (val) {
        if (!val.startsWith('.')) val = '.' + val;
        state.tldList.push(val);
        localStorage.setItem('tldList', JSON.stringify(state.tldList));
        document.getElementById('tld-input').value = ''; updateSettingsUI(); rebuildRegex();
    }
}
function removeTLD(tld) {
    state.tldList = state.tldList.filter(t => t !== tld);
    localStorage.setItem('tldList', JSON.stringify(state.tldList));
    updateSettingsUI(); rebuildRegex();
}
function addTLDFromLibrary(tld) {
    state.tldList.push(tld);
    localStorage.setItem('tldList', JSON.stringify(state.tldList));
    updateSettingsUI(); rebuildRegex();
}

function resetToDefaults() {
    if (confirm('Reset filters to defaults?')) {
        state.keywordsList = [...DEFAULTS.keywords];
        state.tldList = [...DEFAULTS.tlds];
        localStorage.setItem('keywordsList', JSON.stringify(state.keywordsList));
        localStorage.setItem('tldList', JSON.stringify(state.tldList));
        updateSettingsUI(); rebuildRegex();
    }
}

function clearAllData() {
    if (confirm('CLEAR ALL DATA including history and block lists?')) {
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
        const found = proj.rawInput.match(CONFIG.emailRegex) || [];
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
    state.dbFilteredEmails = [...fullDbCache];
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
            const isExpired = item.lastSent && item.expiresAt !== Infinity && Date.now() > item.expiresAt;
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

function filterDatabaseView() {
    const query = document.getElementById('db-search').value.toLowerCase().trim();
    state.dbFilteredEmails = fullDbCache.filter(e =>
        e.email.toLowerCase().includes(query) ||
        e.email.split('@')[1].toLowerCase().includes(query)
    );
    state.dbCurrentPage = 1;
    displayDatabaseResults();
}

function exportDatabase(type) {
    if (fullDbCache.length === 0) {
        alert('Database is empty.');
        return;
    }

    let content = '';
    let filename = `email_database_full_${new Date().toISOString().split('T')[0]}`;

    if (type === 'csv') {
        content = 'Email,Last Sent,Status\n';
        fullDbCache.forEach(e => {
            const lastSent = e.lastSent ? new Date(e.lastSent).toLocaleDateString() : 'Never';
            const status = !e.lastSent ? 'New' : ((e.expiresAt !== Infinity && Date.now() > e.expiresAt) ? 'Cooldown Over' : 'On Cooldown');
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
initDB().then(() => {
    rebuildRegex();
    updateDomainFiltersUI();
    updateSettingsUI();
    renderProjectHistory();
});
