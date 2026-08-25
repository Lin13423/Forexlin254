// Shared authentication guard for AssetGuard pages (Optimized for instant navigation)
import { getFirebaseApp } from "./ag-firebase.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

// 1. Check if session storage already knows the user is logged in
const isLocallyAuthenticated = sessionStorage.getItem("ag_authenticated") === "true";

// 2. Only hide the page if there's no local cache (prevents flashing on page navigation)
if (!isLocallyAuthenticated) {
  document.documentElement.style.visibility = "hidden";
}

const app = getFirebaseApp();
const auth = getAuth(app);

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
