// Strict and optimized authentication guard for AssetGuard pages
import { getFirebaseApp } from "./ag-firebase.js";
import { getAuth, onAuthStateChanged, isSignInWithEmailLink, signInWithEmailLink } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

// 1. ALWAYS hide the page immediately to prevent unauthorized viewing or content flashing
const hasVerifiedSession = sessionStorage.getItem("ag_auth_verified") === "1";
if (!hasVerifiedSession) document.documentElement.style.visibility = "hidden";

function notifyPageReady() {
  if (window.parent !== window) {
    window.parent.postMessage({ type: "assetguard:page-ready", page: window.location.pathname.split("/").pop() }, window.location.origin);
  }
}

const app = getFirebaseApp();
const auth = getAuth(app);

// Complete internal passcode reset link if present
async function completeInternalResetLink() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("internalReset")) return;
  if (!isSignInWithEmailLink(auth, window.location.href)) return;
  const email = localStorage.getItem("ag_internal_reset_email")
    || window.prompt("Confirm the e-mail address this reset link was sent to");
  if (!email) return;
  try {
    await signInWithEmailLink(auth, email, window.location.href);
    localStorage.removeItem("ag_internal_reset_email");
    const clean = new URL(window.location.href);
    ["apiKey", "oobCode", "mode", "lang", "continueUrl", "tenantId"].forEach(key => clean.searchParams.delete(key));
    history.replaceState(null, "", `${clean.pathname}${clean.search}`);
  } catch (error) {
    if (typeof AGErrors !== "undefined") AGErrors.report("internal reset link sign-in", error);
  }
}

await completeInternalResetLink();

let authResolved = false;

// 2. Listen securely for Firebase Auth state
onAuthStateChanged(auth, (user) => {
  authResolved = true;
  if (user) {
    // Firebase remains the source of truth; this marker only avoids a blank repaint
    // while the next protected page confirms the same session.
    sessionStorage.setItem("ag_auth_verified", "1");
    document.documentElement.style.visibility = "";
    notifyPageReady();
  } else {
    sessionStorage.removeItem("ag_auth_verified");
    window.location.replace("index.html");
  }
}, (error) => {
    sessionStorage.removeItem("ag_auth_verified");
    if (typeof AGErrors !== 'undefined') {
        AGErrors.report("authentication initialization", error);
    }
    window.location.replace("index.html?authError=initialization");
});

// 3. Safety fallback: If Firebase takes longer than 4 seconds to respond, force a redirect
setTimeout(() => {
  if (!authResolved) {
    sessionStorage.removeItem("ag_auth_verified");
    window.location.replace("index.html?authError=timeout");
  }
}, 4000);
