// Optimized Hybrid Authentication Guard for AssetGuard
import { getFirebaseApp } from "./ag-firebase.js";
import { getAuth, onAuthStateChanged, isSignInWithEmailLink, signInWithEmailLink } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

// 1. Check if the browser session already knows the user is logged in
const isLocallyCached = sessionStorage.getItem("ag_authenticated") === "true";

// Only hide the page if there is NO local cache (prevents delays on page-to-page navigation)
if (!isLocallyCached) {
  document.documentElement.style.visibility = "hidden";
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

let authChecked = false;

// 2. Listen to Firebase Auth state in the background
onAuthStateChanged(auth, (user) => {
  authChecked = true;
  if (user) {
    // Valid user confirmed by Firebase — cache the state and ensure page is visible
    sessionStorage.setItem("ag_authenticated", "true");
    document.documentElement.style.visibility = "";
  } else {
    // Not logged in — clear cache and immediately eject
    sessionStorage.removeItem("ag_authenticated");
    window.location.replace("index.html");
  }
}, (error) => {
    if (typeof AGErrors !== 'undefined') {
        AGErrors.report("authentication initialization", error);
    }
    window.location.replace("index.html?authError=initialization");
});

// 3. Fallback timeout if offline or Firebase hangs
setTimeout(() => {
  if (!authChecked && !isLocallyCached) {
    window.location.replace("index.html?authError=timeout");
  }
}, 4000);
