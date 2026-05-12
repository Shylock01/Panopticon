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

  let mode = 'login'; 

  function showModal(newMode) {
    if (!isConfigured) {
      alert("Firebase is not yet configured.");
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
        loggedOutGroup.setAttribute('hidden', '');
        loggedInGroup.removeAttribute('hidden');
        userEmailSpan.textContent = user.email;

        // --- FULL SYNC ON LOGIN ---
        const userRef = db.collection('users').doc(user.uid);
        const doc = await userRef.get();

        if (doc.exists) {
          const data = doc.data();
          
          // 1. Sync Token
          if (data.ghToken && !Store.getToken()) {
            Store.saveToken(data.ghToken);
          }
          
          // 2. Sync App List
          if (data.linkedApps) {
            const localApps = await Store.getLinkedApps();
            if (localApps.length === 0) {
              for (const app of data.linkedApps) {
                await Store.linkApp(app);
              }
              // Force reload to init sphere with new apps
              window.location.reload();
              return;
            }
          }
          
          // 3. Sync App States (Sub-collection)
          const statesSnap = await userRef.collection('states').get();
          for (const stateDoc of statesSnap.docs) {
            const repoName = stateDoc.id;
            const stateData = stateDoc.data().payload;
            const localState = await Store.getAppState(repoName);
            if (!localState) {
              await Store.setAppState(repoName, stateData);
            }
          }
        }
      } else {
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

    syncToken: async (token) => {
      if (auth && auth.currentUser) {
        await db.collection('users').doc(auth.currentUser.uid).set({ ghToken: token }, { merge: true });
      }
    },

    // Nuclear Sync: Push all local data to cloud
    syncAll: async () => {
      if (!auth || !auth.currentUser) return;
      const uid = auth.currentUser.uid;
      const userRef = db.collection('users').doc(uid);
      
      const apps = await Store.getLinkedApps();
      const token = Store.getToken();
      
      // Sync list and token
      await userRef.set({ 
        ghToken: token,
        linkedApps: apps,
        lastSync: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // Sync individual app states
      for (const app of apps) {
        const state = await Store.getAppState(app.repoName);
        if (state) {
          await userRef.collection('states').doc(app.repoName).set({
            payload: state,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
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
