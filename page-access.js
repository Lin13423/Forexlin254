(function () {
    const ADMIN_EMAIL = "forexlin254@gmail.com";

    if (!firebase.apps.length) {
        firebase.initializeApp(AG_FIREBASE_CONFIG);
    }

    const auth = firebase.auth();
    const database = firebase.database();

    window.AGPageAccess = {
        async authorize(page) {
            const user = auth.currentUser;
            if (!user) return false;
            if (user.email && user.email.toLowerCase() === ADMIN_EMAIL) return true;

            const snapshot = await database.ref(`page_access/${page}/${user.uid}`).once("value");
            return snapshot.val() === true;
        }
    };
}());