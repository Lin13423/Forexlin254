globalThis.AGUtils = {
    showDialog(message, { title = "Notice", type = "info" } = {}) {
        let overlay = document.getElementById("ag-dialog-overlay");
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "ag-dialog-overlay";
            overlay.innerHTML = `
                <style>
                    #ag-dialog-overlay { position:fixed; inset:0; z-index:10050; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(7,21,34,.72); backdrop-filter:blur(7px); }
                    #ag-dialog-overlay .ag-dialog { width:min(100%,380px); padding:24px; border-radius:18px; background:#fff; box-shadow:0 22px 55px rgba(0,0,0,.25); color:#071522; font-family:system-ui,sans-serif; }
                    #ag-dialog-overlay h3 { margin:0 0 8px; font-size:18px; }
                    #ag-dialog-overlay p { margin:0 0 20px; color:#52635f; line-height:1.5; font-size:14px; white-space:pre-wrap; }
                    #ag-dialog-overlay button { width:100%; border:0; border-radius:10px; padding:12px; background:#071522; color:#fff; font-weight:700; cursor:pointer; }
                    #ag-dialog-overlay[data-type="error"] h3 { color:#b42318; }
                    #ag-dialog-overlay[data-type="success"] h3 { color:#087443; }
                </style>
                <div class="ag-dialog" role="dialog" aria-modal="true" aria-labelledby="ag-dialog-title">
                    <h3 id="ag-dialog-title"></h3><p id="ag-dialog-message"></p>
                    <button type="button" id="ag-dialog-close">OK</button>
                </div>`;
            document.body.appendChild(overlay);
            overlay.addEventListener("click", (event) => {
                if (event.target === overlay || event.target.id === "ag-dialog-close") overlay.remove();
            });
        }
        overlay.dataset.type = type;
        overlay.querySelector("#ag-dialog-title").textContent = title;
        overlay.querySelector("#ag-dialog-message").textContent = String(message ?? "");
        overlay.style.display = "flex";
    },

    resolveActiveUID({ fallback = "global_terminal_user", persist = true } = {}) {
        let uid = null;
        const isMissing = (value) => value == null || ["", "null", "undefined"].includes(String(value).trim());

        try {
            const params = new URLSearchParams(window.location.search);
            for (const key of ["uid", "user", "currentUID", "userId"]) {
                const value = params.get(key);
                if (!isMissing(value)) {
                    uid = value.trim();
                    break;
                }
            }
        } catch (_) {}

        if (isMissing(uid)) {
            try {
                if (window.AppInventor && typeof window.AppInventor.getWebViewString === "function") {
                    const raw = window.AppInventor.getWebViewString();
                    if (!isMissing(raw)) {
                        const trimmed = String(raw).trim();
                        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                            try {
                                const parsed = JSON.parse(trimmed);
                                uid = parsed && (parsed.uid || parsed.userId || parsed.username) || raw;
                            } catch (_) {
                                uid = raw;
                            }
                        } else {
                            uid = raw;
                        }
                    }
                }
            } catch (_) {}
        }

        if (isMissing(uid)) {
            try {
                uid = localStorage.getItem("ag_active_uid");
            } catch (_) {}
        }
        if (isMissing(uid)) uid = fallback;
        uid = String(uid).trim();
        if (persist) {
            try {
                localStorage.setItem("ag_active_uid", uid);
            } catch (_) {}
        }
        return uid;
    },

    getActiveUID({ fallback = null, persist = false } = {}) {
        let uid = null;
        try {
            uid = localStorage.getItem("ag_active_uid");
        } catch (_) {}
        if (uid == null || ["", "null", "undefined"].includes(String(uid).trim())) uid = fallback;
        if (uid != null) uid = String(uid).trim();
        if (persist && uid != null) {
            try {
                localStorage.setItem("ag_active_uid", uid);
            } catch (_) {}
        }
        return uid;
    },

    userPath(uid, ...segments) {
        return ["users", uid, ...segments].join("/");
    },

    readJSON(key, fallback) {
        try {
            const value = localStorage.getItem(key);
            return value == null ? fallback : JSON.parse(value);
        } catch (_) {
            return fallback;
        }
    },

    writeJSON(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    },

    uidKey(base, uid) {
        return `${base}_${uid}`;
    },

    formatAmount(value, { minDecimals } = {}) {
        const amount = parseFloat(value);
        if (!Number.isFinite(amount)) return "0";
        return amount.toLocaleString(undefined, minDecimals == null ? undefined : { minimumFractionDigits: minDecimals });
    },

    formatCurrency(value, { prefix = "KES", minDecimals } = {}) {
        return `${prefix} ${this.formatAmount(value, { minDecimals })}`;
    },

    formatDateTime(value, { fallback = "Unknown Time", locale, options } = {}) {
        if (value == null || value === "") return fallback;
        const date = new Date(value);
        if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return fallback;
        return date.toLocaleString(locale, options);
    },

    escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (match) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        }[match]));
    },

    showToast(message, { type = "", duration = 2500, containerId = "toastContainer", elementId = "toast" } = {}) {
        const container = document.getElementById(containerId);
        if (container) {
            const toast = document.createElement("div");
            toast.className = `toast${type ? ` ${type}` : ""}`;
            toast.textContent = message;
            container.appendChild(toast);
            setTimeout(() => toast.remove(), duration);
            return;
        }

        const toast = document.getElementById(elementId);
        if (!toast) return;
        toast.textContent = message;
        toast.className = `toast${type ? ` ${type}` : ""}`;
        toast.style.display = "block";
        clearTimeout(window.AGUtilsToastTimer);
        window.AGUtilsToastTimer = setTimeout(() => {
            toast.style.display = "none";
        }, duration);
    },

    mergePendingWithCloud(cloudRecords, pendingRecords, { sortKey = "timestamp" } = {}) {
        const cloudIds = new Set(cloudRecords.map((record) => record.id));
        const uniquePending = pendingRecords.filter((record) => !cloudIds.has(record.id));
        return [...uniquePending, ...cloudRecords].sort((a, b) => new Date(b[sortKey]) - new Date(a[sortKey]));
    },

    showAccessDenied({ message = "Access denied.", targetId } = {}) {
        const target = targetId ? document.getElementById(targetId) : document.body;
        if (target) target.innerHTML = `<div style="text-align:center;padding:40px;">${this.escapeHtml(message)}</div>`;
    }
};

globalThis.alert = (message) => globalThis.AGUtils.showDialog(message, { type: "error", title: "Action could not be completed" });
