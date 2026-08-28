// Shared authentication guard for AssetGuard pages (Optimized for instant navigation)
import { getFirebaseApp } from "./ag-firebase.js";
import { getAuth, onAuthStateChanged, isSignInWithEmailLink, signInWithEmailLink } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

// 1. Check if session storage already knows the user is logged in
const isLocallyAuthenticated = sessionStorage.getItem("ag_authenticated") === "true";

// 2. Only hide the page if there's no local cache (prevents flashing on page navigation)
if (!isLocallyAuthenticated) {
  document.documentElement.style.visibility = "hidden";
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
    // Save state locally so future page navigation opens instantly
    sessionStorage.setItem("ag_authenticated", "true");
    document.documentElement.style.visibility = "";
  } else {
    // Clear cache and kick unauthenticated users out
    sessionStorage.removeItem("ag_authenticated");
    window.location.replace("index.html");
  }
}, (error) => {
    if (typeof AGErrors !== 'undefined') {
        AGErrors.report("authentication initialization", error);
    }
    document.documentElement.style.visibility = "";
    window.location.replace("index.html?authError=initialization");
});
