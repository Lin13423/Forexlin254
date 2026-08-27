(function () {
    if (!firebase.apps.length) {
        firebase.initializeApp(AG_FIREBASE_CONFIG);
    }

    const auth = firebase.auth();

    window.AGPageAccess = {
        async authorize() {
            return Boolean(auth.currentUser);
        }
    };
}());