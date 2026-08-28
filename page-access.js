(function () {
    if (globalThis.firebase && !firebase.apps.length) {
        firebase.initializeApp(AG_FIREBASE_CONFIG);
    }

    let auth;

    function getAuth() {
        if (!auth && globalThis.firebase) {
            if (!firebase.apps.length) firebase.initializeApp(AG_FIREBASE_CONFIG);
            auth = firebase.auth();
        }
        return auth;
    }

    const pageNames = {
        "sales.html": "Sales Ledger", "purchases.html": "Purchases",
        "expenses.html": "Expenses", "expenses_history.html": "Expense History",
        "master-ledger.html": "Master Ledger", "cash-report.html": "Cash Report",
        "credit-report.html": "Credit Report", "bank-report.html": "Bank Report",
        "mpesa-report.html": "M-Pesa Report", "stock.html": "Stock",
        "crm.html": "CRM", "marketing-team.html": "Marketing Team",
        "live-tracking.html": "Live Tracking", "dispatched.html": "Dispatch",
        "notebook.html": "Notebook", "local_db.html": "Local Database",
        "bi_dashboard.html": "BI Dashboard", "admin.html": "Admin"
    };

    function getPageKey(page = window.location.pathname.split("/").pop()) {
        if (page === "sales.html") return "sales";
        if (page === "purchases.html") return "purchases";
        return "other";
    }

    async function getPagePasswords(user) {
        const cacheKey = globalThis.AGUtils?.uidKey("ag_profile_cache", user.uid);
        const cached = cacheKey ? globalThis.AGUtils.readJSON(cacheKey, null) : null;
        if (cached?.pagePasswords) return cached.pagePasswords;
        try {
            const settings = await firebase.database().ref(`user_settings/${user.uid}`).once("value");
            return settings.val()?.pagePasswords || {};
        } catch (error) {
            if (globalThis.AGErrors) AGErrors.report("page password lookup", error);
            return {};
        }
    }

    async function authorizePage(page = window.location.pathname.split("/").pop()) {
        const user = getAuth()?.currentUser;
        if (!user) return false;
        const passwords = await getPagePasswords(user);
        const password = passwords[getPageKey(page)];
        if (!password) return true;
        const unlockKey = `ag_page_unlocked_${user.uid}_${getPageKey(page)}`;
        if (sessionStorage.getItem(unlockKey) === "true") return true;
        const entered = window.prompt(`Enter the ${pageNames[page] || "page"} access password`);
        if (entered === password) {
            sessionStorage.setItem(unlockKey, "true");
            return true;
        }
        window.alert("Incorrect page access password.");
        return false;
    }

    function protectCurrentPage() {
        const page = window.location.pathname.split("/").pop();
        if (!pageNames[page]) return;
        getAuth()?.onAuthStateChanged?.(async (user) => {
            if (user && !(await authorizePage(page))) window.location.replace("index.html");
        });
    }

    window.AGPageAccess = {
        authorize: authorizePage
    };

    protectCurrentPage();
}());