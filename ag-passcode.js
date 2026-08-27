// Shared internal passcode for every in-app (non-login) security gate.
// One passcode per account: changing it in Settings changes it on all pages.
// The login/reset system in login.html is a completely separate mechanism.
import { getFirebaseApp, getDb } from "./ag-firebase.js";
import { ref, get, set, update } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
import { getAuth, onAuthStateChanged, sendSignInLinkToEmail } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

const ITERATIONS = 120000;
const RESET_TTL_MS = 30 * 60 * 1000;
const MIN_LENGTH = 4;
const MAX_LENGTH = 32;
const CACHE_TTL_MS = 15000;
const NOT_CONFIGURED_MESSAGE = "No internal passcode has been set yet. Open Settings to create one.";

let cachedRecord = null;
let cachedAt = 0;
let userPromise = null;

function textBytes(value) {
    return new TextEncoder().encode(value);
}

function toHex(bytes) {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
}

function randomHex(byteLength) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return toHex(bytes);
}

function subtle() {
    if (!globalThis.crypto || !crypto.subtle) {
        throw new Error("Secure cryptography is unavailable in this browser context.");
    }
    return crypto.subtle;
}

async function derive(passcode, saltHex, iterations) {
    const keyMaterial = await subtle().importKey("raw", textBytes(passcode), "PBKDF2", false, ["deriveBits"]);
    const bits = await subtle().deriveBits(
        { name: "PBKDF2", salt: fromHex(saltHex), iterations, hash: "SHA-256" },
        keyMaterial,
        256
    );
    return toHex(new Uint8Array(bits));
}

async function sha256Hex(value) {
    const digest = await subtle().digest("SHA-256", textBytes(value));
    return toHex(new Uint8Array(digest));
}

function constantTimeEquals(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function currentUser() {
    if (!userPromise) {
        userPromise = new Promise((resolve) => {
            const auth = getAuth(getFirebaseApp());
            if (auth.currentUser) {
                resolve(auth.currentUser);
                return;
            }
            const unsubscribe = onAuthStateChanged(auth, (user) => {
                unsubscribe();
                resolve(user);
            }, () => {
                unsubscribe();
                resolve(null);
            });
        });
    }
    return userPromise;
}

async function requireUid() {
    const user = await currentUser();
    if (!user) throw new Error("You must be signed in to manage the internal passcode.");
    return user.uid;
}

// Updated to target user_settings matching your database rules and settings structure
function securityRef(uid) {
    return ref(getDb(), `user_settings/${uid}/internal_passcode`);
}

async function loadRecord({ force = false } = {}) {
    if (!force && cachedRecord !== null && Date.now() - cachedAt < CACHE_TTL_MS) return cachedRecord;
    const uid = await requireUid();
    const snapshot = await get(securityRef(uid));
    cachedRecord = snapshot.exists() ? snapshot.val() : {};
    cachedAt = Date.now();
    return cachedRecord;
}

function invalidateCache() {
    cachedRecord = null;
    cachedAt = 0;
}

function validateNewPasscode(passcode) {
    const value = String(passcode ?? "").trim();
    if (value.length < MIN_LENGTH) throw new Error(`Passcode must be at least ${MIN_LENGTH} characters.`);
    if (value.length > MAX_LENGTH) throw new Error(`Passcode must be at most ${MAX_LENGTH} characters.`);
    return value;
}

async function matches(record, passcode) {
    if (!record || !record.hash || !record.salt) return false;
    const candidate = await derive(String(passcode), record.salt, record.iterations || ITERATIONS);
    return constantTimeEquals(candidate, record.hash);
}

const AGPasscode = {
    NOT_CONFIGURED_MESSAGE,
    MIN_LENGTH,
    MAX_LENGTH,
    RESET_TTL_MINUTES: RESET_TTL_MS / 60000,

    async isConfigured() {
        const record = await loadRecord();
        return Boolean(record && record.hash);
    },

    async verify(passcode) {
        const value = String(passcode ?? "");
        let record;
        try {
            record = await loadRecord();
        } catch (error) {
            if (globalThis.AGErrors) AGErrors.report("internal passcode verification", error);
            const denied = String(error && (error.code || error.message) || "").toLowerCase().includes("permission");
            return {
                ok: false,
                reason: "unavailable",
                message: denied
                    ? "Security settings are unreachable. Check database rules for user_settings."
                    : (error.message || "Security check unavailable. Check your connection and retry.")
            };
        }
        if (!record || !record.hash) return { ok: false, reason: "not_set", message: NOT_CONFIGURED_MESSAGE };
        if (!value) return { ok: false, reason: "empty", message: "Enter your internal passcode." };
        if (await matches(record, value)) return { ok: true, reason: "ok", message: "" };
        return { ok: false, reason: "mismatch", message: "Incorrect passcode." };
    },

    async check(passcode) {
        try {
            const result = await this.verify(passcode);
            return result.ok;
        } catch (error) {
            if (globalThis.AGErrors) AGErrors.report("internal passcode verification", error);
            return false;
        }
    },

    async setPasscode(newPasscode, { currentPasscode = null, resetToken = null } = {}) {
        const value = validateNewPasscode(newPasscode);
        const uid = await requireUid();
        const record = await loadRecord({ force: true });

        if (record && record.hash) {
            if (resetToken) {
                await this.validateResetToken(resetToken, { record });
            } else if (!(await matches(record, currentPasscode ?? ""))) {
                throw new Error("Current passcode is incorrect.");
            }
        }

        const salt = randomHex(16);
        const hash = await derive(value, salt, ITERATIONS);
        await set(securityRef(uid), {
            hash,
            salt,
            iterations: ITERATIONS,
            algorithm: "PBKDF2-SHA256",
            updatedAt: Date.now(),
            reset: null
        });
        invalidateCache();
    },

    async requestReset(email) {
        const address = String(email ?? "").trim().toLowerCase();
        if (!address) throw new Error("Enter the e-mail address of this account.");
        const user = await currentUser();
        if (!user) throw new Error("You must be signed in to request an internal passcode reset.");
        if (String(user.email || "").toLowerCase() !== address) {
            throw new Error("That e-mail does not match the signed-in account.");
        }

        const token = randomHex(24);
        const tokenHash = await sha256Hex(token);
        const requestedAt = Date.now();
        const expiresAt = requestedAt + RESET_TTL_MS;

        await update(securityRef(user.uid), {
            reset: { tokenHash, email: address, requestedAt, expiresAt, used: false }
        });
        invalidateCache();

        const url = new URL("settings.html", window.location.href);
        url.searchParams.set("internalReset", token);
        url.searchParams.set("uid", user.uid);

        try {
            await sendSignInLinkToEmail(getAuth(getFirebaseApp()), address, {
                url: url.toString(),
                handleCodeInApp: true
            });
            localStorage.setItem("ag_internal_reset_email", address);
        } catch (error) {
            await update(securityRef(user.uid), { reset: null });
            invalidateCache();
            if (error && error.code === "auth/operation-not-allowed") {
                throw new Error("E-mail link delivery is disabled for this Firebase project. Enable 'Email link (passwordless sign-in)' in Firebase Authentication.");
            }
            throw error;
        }

        return { email: address, expiresAt };
    },

    async validateResetToken(token, { record = null } = {}) {
        const value = String(token ?? "").trim();
        if (!value) throw new Error("Reset link is missing its security token.");
        const data = record || (await loadRecord({ force: true }));
        const reset = data && data.reset;
        if (!reset || !reset.tokenHash) throw new Error("No internal passcode reset was requested.");
        if (reset.used) throw new Error("This reset link has already been used.");
        if (!reset.expiresAt || Date.now() > reset.expiresAt) throw new Error("This reset link has expired. Request a new one.");
        const candidate = await sha256Hex(value);
        if (!constantTimeEquals(candidate, reset.tokenHash)) throw new Error("This reset link is not valid.");
        return true;
    },

    async cancelReset() {
        const uid = await requireUid();
        await update(securityRef(uid), { reset: null });
        invalidateCache();
    },

    refresh() {
        invalidateCache();
    }
};

globalThis.AGPasscode = AGPasscode;
globalThis.AGPasscodeReady = Promise.resolve(AGPasscode);

export default AGPasscode;
