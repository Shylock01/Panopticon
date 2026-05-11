// ============================================================
// auth.js — Firebase Authentication & Cloud Sync
// ============================================================
(function () {

  // --- Firebase Config ---
  const firebaseConfig = {
    apiKey: "AIzaSyA5-xrcuhNaz0qL7BQPgenodJZC1a1TcWw",
    authDomain: "panopticon-e15ca.firebaseapp.com",
    projectId: "panopticon-e15ca",
    storageBucket: "panopticon-e15ca.firebasestorage.app",
    messagingSenderId: "1033674121634",
    appId: "1:1033674121634:web:2716aba4ed76cba71352fb",
    measurementId: "G-06GZ02Z34M"
  };

  // Initialize Firebase
  let auth = null;
  let db = null;
  const isConfigured = !firebaseConfig.apiKey.includes("REPLACE_WITH");

  if (isConfigured) {
    // Using the compat SDK patterns from the script tags in index.html
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
  }

  // --- UI Logic Helpers ---
  const modal = document.getElementById('auth-modal');
  const modalTitle = document.getElementById('auth-modal-title');
  const authForm = document.getElementById('auth-form');
  const emailInput = document.getElementById('auth-email');
  const passInput = document.getElementById('auth-password');

  const loggedOutGroup = document.getElementById('auth-logged-out');
  const loggedInGroup = document.getElementById('auth-logged-in');
  const userEmailSpan = document.getElementById('user-email');

  let mode = 'login'; // 'login' or 'signup'

  function showModal(newMode) {
    if (!isConfigured) {
      alert("Firebase is not yet configured. Please follow the instructions to add your API keys.");
      return;
    }
    mode = newMode;
    modalTitle.textContent = mode === 'login' ? 'Login' : 'Create Account';
    modal.removeAttribute('hidden');
    emailInput.focus();
  }

  function hideModal() {
    modal.setAttribute('hidden', '');
    authForm.reset();
  }

  // --- Auth State Handling ---
  if (isConfigured) {
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        // User is logged in
        loggedOutGroup.setAttribute('hidden', '');
        loggedInGroup.removeAttribute('hidden');
        userEmailSpan.textContent = user.email;

        // Try to sync token from Cloud if local is empty
        const localToken = Store.getToken();
        const doc = await db.collection('users').doc(user.uid).get();

        if (doc.exists) {
          const cloudToken = doc.data().ghToken;
          if (cloudToken && !localToken) {
            Store.saveToken(cloudToken);
            window.location.reload(); // Refresh to boot with new token
          }
        } else if (localToken) {
          // If cloud is empty but local has token, sync it up
          await db.collection('users').doc(user.uid).set({ ghToken: localToken }, { merge: true });
        }
      } else {
        // User is logged out
        loggedOutGroup.removeAttribute('hidden');
        loggedInGroup.setAttribute('hidden', '');
      }
    });
  }

  // --- Public API ---
  window.Auth = {
    showLogin: () => showModal('login'),
    showSignup: () => showModal('signup'),
    logout: () => auth.signOut(),

    // Sync local token to cloud
    syncToken: async (token) => {
      if (auth && auth.currentUser) {
        await db.collection('users').doc(auth.currentUser.uid).set({ ghToken: token }, { merge: true });
      }
    }
  };

  // --- Event Listeners ---
  document.getElementById('auth-show-login').addEventListener('click', () => showModal('login'));
  document.getElementById('auth-show-signup').addEventListener('click', () => showModal('signup'));
  document.getElementById('auth-modal-cancel').addEventListener('click', hideModal);
  document.getElementById('auth-logout-btn').addEventListener('click', () => auth.signOut());

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value;
    const pass = passInput.value;

    try {
      if (mode === 'login') {
        await auth.signInWithEmailAndPassword(email, pass);
      } else {
        await auth.createUserWithEmailAndPassword(email, pass);
      }
      hideModal();
    } catch (err) {
      alert(err.message);
    }
  });

})();
