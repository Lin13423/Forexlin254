// ============================================================
// AssetGuard Shared Internal Passcode Security
// ------------------------------------------------------------
// One internal passcode per signed-in account.
// Separate from the Firebase login password.
//
// SECURITY DATA:
// user_settings/{uid}/internal_passcode
//
// RESET DATA:
// user_passcode_resets/{uid}
//
// Reset tokens are never stored directly. Only SHA-256 hashes
// of tokens are stored.
// ============================================================

import { getFirebaseApp, getDb } from "./ag-firebase.js";

import {
    ref,
    get,
    set,
    update,
    remove
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

import {
    getAuth,
    onAuthStateChanged,
    sendSignInLinkToEmail
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";


// ============================================================
// CONFIGURATION
// ============================================================

const ITERATIONS = 120000;

const RESET_TTL_MS = 30 * 60 * 1000;

const MIN_LENGTH = 4;

const MAX_LENGTH = 32;

const CACHE_TTL_MS = 15000;

const NOT_CONFIGURED_MESSAGE =
    "No internal passcode has been set yet. Open Settings to create one.";


// ============================================================
// MEMORY CACHE
// ============================================================

let cachedRecord = null;

let cachedAt = 0;

let userPromise = null;


// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function textBytes(value) {

    return new TextEncoder().encode(String(value));

}


function toHex(bytes) {

    return Array.from(bytes)
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");

}


function fromHex(hex) {

    const output = new Uint8Array(hex.length / 2);

    for (let i = 0; i < output.length; i++) {

        output[i] = parseInt(
            hex.substr(i * 2, 2),
            16
        );

    }

    return output;

}


function randomHex(byteLength) {

    const bytes = new Uint8Array(byteLength);

    crypto.getRandomValues(bytes);

    return toHex(bytes);

}


function subtle() {

    if (
        !globalThis.crypto ||
        !globalThis.crypto.subtle
    ) {

        throw new Error(
            "Secure cryptography is unavailable in this browser."
        );

    }

    return crypto.subtle;

}


// ============================================================
// PBKDF2 PASSCODE HASHING
// ============================================================

async function derive(
    passcode,
    saltHex,
    iterations
) {

    const keyMaterial =
        await subtle().importKey(

            "raw",

            textBytes(passcode),

            "PBKDF2",

            false,

            ["deriveBits"]

        );


    const bits =
        await subtle().deriveBits(

            {

                name: "PBKDF2",

                salt: fromHex(saltHex),

                iterations,

                hash: "SHA-256"

            },

            keyMaterial,

            256

        );


    return toHex(
        new Uint8Array(bits)
    );

}


// ============================================================
// SHA256
// Used for reset token hashing.
// ============================================================

async function sha256Hex(value) {

    const digest =
        await subtle().digest(

            "SHA-256",

            textBytes(value)

        );


    return toHex(
        new Uint8Array(digest)
    );

}


// ============================================================
// CONSTANT TIME STRING COMPARISON
// ============================================================

function constantTimeEquals(a, b) {

    if (
        typeof a !== "string" ||
        typeof b !== "string" ||
        a.length !== b.length
    ) {

        return false;

    }


    let difference = 0;


    for (
        let i = 0;
        i < a.length;
        i++
    ) {

        difference |=
            a.charCodeAt(i) ^
            b.charCodeAt(i);

    }


    return difference === 0;

}


// ============================================================
// FIREBASE AUTH USER
// ============================================================

function currentUser() {

    if (!userPromise) {

        userPromise =
            new Promise((resolve) => {

                const auth =
                    getAuth(
                        getFirebaseApp()
                    );


                if (auth.currentUser) {

                    resolve(
                        auth.currentUser
                    );

                    return;

                }


                const unsubscribe =
                    onAuthStateChanged(

                        auth,

                        (user) => {

                            unsubscribe();

                            resolve(user);

                        },

                        () => {

                            unsubscribe();

                            resolve(null);

                        }

                    );

            });

    }


    return userPromise;

}


// ============================================================
// REQUIRE AUTHENTICATED USER
// ============================================================

async function requireUser() {

    const user =
        await currentUser();


    if (!user) {

        throw new Error(
            "You must be signed in to manage the internal passcode."
        );

    }


    return user;

}


async function requireUid() {

    const user =
        await requireUser();

    return user.uid;

}


// ============================================================
// FIREBASE DATABASE REFERENCES
// ============================================================


// Internal passcode record

function securityRef(uid) {

    return ref(

        getDb(),

        `user_settings/${uid}/internal_passcode`

    );

}


// Reset request record

function resetRef(uid) {

    return ref(

        getDb(),

        `user_passcode_resets/${uid}`

    );

}


// ============================================================
// LOAD PASSCODE RECORD
// ============================================================

async function loadRecord(
    { force = false } = {}
) {

    if (

        !force &&

        cachedRecord !== null &&

        Date.now() - cachedAt <
        CACHE_TTL_MS

    ) {

        return cachedRecord;

    }


    const uid =
        await requireUid();


    const snapshot =
        await get(
            securityRef(uid)
        );


    cachedRecord =
        snapshot.exists()
            ? snapshot.val()
            : {};


    cachedAt =
        Date.now();


    return cachedRecord;

}


// ============================================================
// CLEAR CACHE
// ============================================================

function invalidateCache() {

    cachedRecord = null;

    cachedAt = 0;

}


// ============================================================
// VALIDATE NEW PASSCODE
// ============================================================

function validateNewPasscode(
    passcode
) {

    const value =
        String(passcode ?? "")
            .trim();


    if (
        value.length <
        MIN_LENGTH
    ) {

        throw new Error(

            `Passcode must be at least ${MIN_LENGTH} characters.`

        );

    }


    if (
        value.length >
        MAX_LENGTH
    ) {

        throw new Error(

            `Passcode must be at most ${MAX_LENGTH} characters.`

        );

    }


    return value;

}


// ============================================================
// VERIFY PASSCODE AGAINST HASH
// ============================================================

async function matches(
    record,
    passcode
) {

    if (

        !record ||

        !record.hash ||

        !record.salt

    ) {

        return false;

    }


    const candidate =
        await derive(

            String(passcode),

            record.salt,

            record.iterations ||
            ITERATIONS

        );


    return constantTimeEquals(

        candidate,

        record.hash

    );

}


// ============================================================
// AG PASSCODE API
// ============================================================

const AGPasscode = {


    NOT_CONFIGURED_MESSAGE,

    MIN_LENGTH,

    MAX_LENGTH,

    RESET_TTL_MINUTES:
        RESET_TTL_MS / 60000,


    // --------------------------------------------------------
    // CHECK IF PASSCODE EXISTS
    // --------------------------------------------------------

    async isConfigured() {

        const record =
            await loadRecord();


        return Boolean(

            record &&
            record.hash

        );

    },


    // --------------------------------------------------------
    // VERIFY PASSCODE
    // --------------------------------------------------------

    async verify(passcode) {

        const value =
            String(passcode ?? "");


        let record;


        try {

            record =
                await loadRecord();

        } catch (error) {

            if (
                globalThis.AGErrors
            ) {

                AGErrors.report(

                    "internal passcode verification",

                    error

                );

            }


            const errorText =
                String(

                    error &&
                    (
                        error.code ||
                        error.message
                    ) ||
                    ""

                )
                .toLowerCase();


            const denied =
                errorText.includes(
                    "permission"
                );


            return {

                ok: false,

                reason:
                    "unavailable",

                message:
                    denied

                        ? "Security settings are unreachable. Check Firebase database rules for user_settings."

                        : (
                            error.message ||
                            "Security check unavailable. Check your connection and retry."
                        )

            };

        }


        if (

            !record ||

            !record.hash

        ) {

            return {

                ok: false,

                reason:
                    "not_set",

                message:
                    NOT_CONFIGURED_MESSAGE

            };

        }


        if (!value) {

            return {

                ok: false,

                reason:
                    "empty",

                message:
                    "Enter your internal passcode."

            };

        }


        if (

            await matches(
                record,
                value
            )

        ) {

            return {

                ok: true,

                reason:
                    "ok",

                message:
                    ""

            };

        }


        return {

            ok: false,

            reason:
                "mismatch",

            message:
                "Incorrect passcode."

        };

    },


    // --------------------------------------------------------
    // SIMPLE TRUE/FALSE CHECK
    // --------------------------------------------------------

    async check(passcode) {

        try {

            const result =
                await this.verify(
                    passcode
                );


            return result.ok;

        } catch (error) {

            if (
                globalThis.AGErrors
            ) {

                AGErrors.report(

                    "internal passcode verification",

                    error

                );

            }


            return false;

        }

    },


    // ========================================================
    // CREATE OR CHANGE PASSCODE
    // ========================================================

    async setPasscode(

        newPasscode,

        {

            currentPasscode = null,

            resetToken = null

        } = {}

    ) {


        const value =
            validateNewPasscode(
                newPasscode
            );


        const user =
            await requireUser();


        const uid =
            user.uid;


        const record =
            await loadRecord({

                force: true

            });


        // ----------------------------------------------------
        // EXISTING PASSCODE REQUIRES VERIFICATION
        // ----------------------------------------------------

        if (

            record &&
            record.hash

        ) {


            if (resetToken) {

                await this.validateResetToken(

                    resetToken

                );

            }


            else if (

                !(

                    await matches(

                        record,

                        currentPasscode ?? ""

                    )

                )

            ) {

                throw new Error(
                    "Current passcode is incorrect."
                );

            }

        }


        // ----------------------------------------------------
        // CREATE NEW HASH
        // ----------------------------------------------------

        const salt =
            randomHex(16);


        const hash =
            await derive(

                value,

                salt,

                ITERATIONS

            );


        // ----------------------------------------------------
        // SAVE PASSCODE
        // ----------------------------------------------------

        await set(

            securityRef(uid),

            {

                hash,

                salt,

                iterations:
                    ITERATIONS,

                algorithm:
                    "PBKDF2-SHA256",

                updatedAt:
                    Date.now()

            }

        );


        // ----------------------------------------------------
        // RESET TOKEN MUST ONLY WORK ONCE
        // ----------------------------------------------------

        if (resetToken) {

            await remove(

                resetRef(uid)

            );

        }


        invalidateCache();

    },


    // ========================================================
    // REQUEST RESET EMAIL
    // ========================================================

    async requestReset(email) {


        const address =
            String(email ?? "")
                .trim()
                .toLowerCase();


        if (!address) {

            throw new Error(
                "Enter the e-mail address of this account."
            );

        }


        const user =
            await requireUser();


        // ----------------------------------------------------
        // ENSURE USER CAN ONLY RESET THEIR OWN PASSCODE
        // ----------------------------------------------------

        if (

            String(
                user.email || ""
            )
            .toLowerCase()

            !==

            address

        ) {

            throw new Error(
                "That e-mail does not match the signed-in account."
            );

        }


        // ----------------------------------------------------
        // CREATE SECURE TOKEN
        // ----------------------------------------------------

        const token =
            randomHex(32);


        // Store only the hash

        const tokenHash =
            await sha256Hex(
                token
            );


        const requestedAt =
            Date.now();


        const expiresAt =
            requestedAt +
            RESET_TTL_MS;


        // ----------------------------------------------------
        // SAVE RESET REQUEST
        // ----------------------------------------------------

        await set(

            resetRef(
                user.uid
            ),

            {

                tokenHash,

                email:
                    address,

                requestedAt,

                expiresAt,

                used:
                    false

            }

        );


        // ----------------------------------------------------
        // CREATE RESET URL
        // ----------------------------------------------------

        const url =
            new URL(

                "settings.html",

                window.location.href

            );


        url.searchParams.set(

            "internalReset",

            token

        );


        // UID is useful for page context,
        // but authentication still controls access.

        url.searchParams.set(

            "uid",

            user.uid

        );


        // ----------------------------------------------------
        // SEND EMAIL LINK
        // ----------------------------------------------------

        try {

            await sendSignInLinkToEmail(

                getAuth(
                    getFirebaseApp()
                ),

                address,

                {

                    url:
                        url.toString(),

                    handleCodeInApp:
                        true

                }

            );


            localStorage.setItem(

                "ag_internal_reset_email",

                address

            );

        }


        catch (error) {


            // Remove reset request if email fails

            await remove(

                resetRef(
                    user.uid
                )

            );


            if (

                error &&
                error.code ===
                "auth/operation-not-allowed"

            ) {

                throw new Error(

                    "E-mail link delivery is disabled. Enable Email Link (passwordless sign-in) in Firebase Authentication."

                );

            }


            if (

                error &&
                error.code ===
                "auth/invalid-continue-uri"

            ) {

                throw new Error(

                    "The AssetGuard website URL is not authorized in Firebase Authentication."

                );

            }


            if (

                error &&
                error.code ===
                "auth/unauthorized-continue-uri"

            ) {

                throw new Error(

                    "This website domain must be added to Firebase Authentication Authorized Domains."

                );

            }


            throw error;

        }


        return {

            email:
                address,

            expiresAt

        };

    },


    // ========================================================
    // VALIDATE RESET TOKEN
    // ========================================================

    async validateResetToken(token) {


        const value =
            String(token ?? "")
                .trim();


        if (!value) {

            throw new Error(
                "Reset link is missing its security token."
            );

        }


        const user =
            await requireUser();


        const uid =
            user.uid;


        const snapshot =
            await get(

                resetRef(uid)

            );


        if (

            !snapshot.exists()

        ) {

            throw new Error(
                "No internal passcode reset was requested."
            );

        }


        const reset =
            snapshot.val();


        // ----------------------------------------------------
        // ALREADY USED
        // ----------------------------------------------------

        if (reset.used) {

            throw new Error(
                "This reset link has already been used."
            );

        }


        // ----------------------------------------------------
        // EXPIRED
        // ----------------------------------------------------

        if (

            !reset.expiresAt ||

            Date.now() >
            Number(
                reset.expiresAt
            )

        ) {

            throw new Error(
                "This reset link has expired. Request a new one."
            );

        }


        // ----------------------------------------------------
        // TOKEN CHECK
        // ----------------------------------------------------

        const candidate =
            await sha256Hex(
                value
            );


        if (

            !constantTimeEquals(

                candidate,

                reset.tokenHash

            )

        ) {

            throw new Error(
                "This reset link is not valid."
            );

        }


        return true;

    },


    // ========================================================
    // CANCEL RESET
    // ========================================================

    async cancelReset() {


        const uid =
            await requireUid();


        await remove(

            resetRef(uid)

        );


        invalidateCache();

    },


    // ========================================================
    // MANUALLY CLEAR CACHE
    // ========================================================

    refresh() {

        invalidateCache();

    }

};


// ============================================================
// GLOBAL ACCESS
// ============================================================

globalThis.AGPasscode =
    AGPasscode;


globalThis.AGPasscodeReady =
    Promise.resolve(
        AGPasscode
    );


export default AGPasscode;