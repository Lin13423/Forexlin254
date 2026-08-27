(function () {
    if (!firebase.apps.length) {
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

    function sendResetEmail(email) {
        const expiresAt = Date.now() + (30 * 60 * 1000);
        const resetUrl = new URL("reset-password.html", window.location.href);
        resetUrl.searchParams.set("expires", String(expiresAt));
        const firebaseAuth = getAuth();
        if (!firebaseAuth) return Promise.reject(new Error("Authentication is still loading."));
        return firebaseAuth.sendPasswordResetEmail(email, {
            url: resetUrl.href,
            handleCodeInApp: false
        });
    }

    function addResetControl() {
        if (!document.body || document.getElementById("ag-reset-control")) return;
        const control = document.createElement("button");
        control.id = "ag-reset-control";
        control.type = "button";
        control.textContent = "Reset password";
        control.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:9998;border:0;border-radius:8px;padding:10px 14px;background:#001A35;color:#fff;font:600 12px system-ui;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.18);";
        control.addEventListener("click", () => {
            const email = window.prompt("Enter your account email");
            if (!email || !email.trim()) return;
            sendResetEmail(email.trim().toLowerCase())
                .then(() => window.alert("Reset link sent. It expires in 30 minutes."))
                .catch((error) => window.alert(error.code === "auth/user-not-found"
                    ? "No account is registered with that email."
                    : "Could not send reset link."));
        });
        document.body.appendChild(control);
    }

    window.AGPageAccess = {
        async authorize() {
            return Boolean(getAuth()?.currentUser);
        },
        sendResetEmail
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addResetControl);
    else addResetControl();
}());