// Shared authentication guard for AssetGuard pages (Optimized for instant navigation)
import { getFirebaseApp } from "./ag-firebase.js";
import { getAuth, onAuthStateChanged, isSignInWithEmailLink, signInWithEmailLink } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

// CRITICAL: Hide entire page until authentication is verified
// This prevents any content from being visible to unauthenticated users
document.documentElement.style.visibility = "hidden";
document.body.style.opacity = "0";

// 1. Check if session storage already knows the user is logged in (UX optimization only)
const isLocallyAuthenticated = sessionStorage.getItem("ag_authenticated") === "true";

// 2. Only show page quickly if there's local cache (prevents re-login on navigation)
if (isLocallyAuthenticated) {
  document.documentElement.style.visibility = "visible";
  document.body.style.opacity = "1";
}

const app = getFirebaseApp();
const auth = getAuth(app);

// Internal-passcode reset links arrive as Firebase e-mail links. Completing the
// link here lets the reset finish on a device where the session is not cached.
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

onAuthStateChanged(auth, (user) => {
  if (user) {
    // User is authenticated - show page and cache for UX
    sessionStorage.setItem("ag_authenticated", "true");
    sessionStorage.setItem("ag_user_id", user.uid);
    document.documentElement.style.visibility = "visible";
    document.body.style.opacity = "1";
  } else {
    // User is NOT authenticated - clear all session data and redirect to login
    sessionStorage.removeItem("ag_authenticated");
    sessionStorage.removeItem("ag_user_id");
    document.documentElement.style.visibility = "hidden";
    document.body.style.opacity = "0";
    // Force a hard redirect to prevent back-button access
    window.location.replace("index.html");
  }
}, (error) => {
    // Auth error - treat as unauthenticated for security
    if (typeof AGErrors !== 'undefined') {
        AGErrors.report("authentication initialization", error);
    }
    sessionStorage.removeItem("ag_authenticated");
    sessionStorage.removeItem("ag_user_id");
    document.documentElement.style.visibility = "hidden";
    document.body.style.opacity = "0";
    window.location.replace("index.html?authError=initialization");
});
