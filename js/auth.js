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

  function updateAuthUI(user) {
    if (user) {
      loggedOutGroup.setAttribute('hidden', '');
      loggedInGroup.removeAttribute('hidden');
      userEmailSpan.textContent = user.email;
    } else {
      loggedOutGroup.removeAttribute('hidden');
      loggedInGroup.setAttribute('hidden', '');
    }
  }

  // --- Auth State Handling ---
  if (isConfigured) {
    auth.onAuthStateChanged(async (user) => {
      updateAuthUI(user);
      if (user) {
        // --- REAL-TIME SYNC ---
        try {
          const userRef = db.collection('users').doc(user.uid);
          
          // 1. Initial login check: if document is new or never synced, push local state first
          const docSnap = await userRef.get();
          if (!docSnap.exists || !docSnap.data().lastSync) {
            console.log('[Sync] New account or unsynced user. Pushing local data to cloud.');
            if (window.Auth && window.Auth.syncAll) {
              await window.Auth.syncAll();
            }
          }

          if (window._syncUnsubscribe) window._syncUnsubscribe();
          if (window._statesUnsubscribe) window._statesUnsubscribe();
          
          // 2. Profile and Config Document Listener
          window._syncUnsubscribe = userRef.onSnapshot(async (doc) => {
            if (doc.exists) {
              const data = doc.data();
              let needsReinit = false;
              let needsStyleUpdate = false;
              
              // Sync Token
              if (data.ghToken) {
                const localToken = Store.getToken();
                if (localToken !== data.ghToken) {
                  Store.saveToken(data.ghToken);
                }
              }
              
              // Sync App List (Compare & Overwrite to support delete/add replication)
              if (data.linkedApps) {
                const localApps = await Store.getLinkedApps();
                if (JSON.stringify(localApps) !== JSON.stringify(data.linkedApps)) {
                  await Store.saveLinkedApps(data.linkedApps);
                  needsReinit = true;
                }
              }
              
              // Sync Styles
              if (data.stylesConfig) {
                const localStyles = await Store.getStyles();
                if (!localStyles || localStyles.accountSync !== false) {
                  if (!localStyles || JSON.stringify(localStyles) !== JSON.stringify(data.stylesConfig)) {
                    await Store.saveStyles(data.stylesConfig);
                    needsStyleUpdate = true;
                  }
                }
              }

              // Sync Audio Settings
              if (data.audioConfig) {
                const localAudio = await Store.getAudioConfig();
                if (!localAudio || JSON.stringify(localAudio) !== JSON.stringify(data.audioConfig)) {
                  await Store.saveAudioConfig(data.audioConfig);
                  needsStyleUpdate = true;
                }
              }

              if (needsReinit || needsStyleUpdate) {
                if (window.Main && window.Main.initStyles && window.Main.initSphere) {
                  if (needsStyleUpdate) await window.Main.initStyles();
                  await window.Main.initSphere();
                } else {
                  window.location.reload();
                }
              }
            }
          }, (syncErr) => {
            console.error('Real-time cloud sync failed:', syncErr);
          });

          // 3. App States Subcollection Listener (Cross-device real-time sync)
          window._statesUnsubscribe = userRef.collection('states').onSnapshot(async (snapshot) => {
            for (const change of snapshot.docChanges()) {
              if (change.type === 'added' || change.type === 'modified') {
                const repoName = change.doc.id;
                const stateData = change.doc.data().payload;
                
                const localState = await Store.getAppState(repoName);
                if (JSON.stringify(localState) !== JSON.stringify(stateData)) {
                  await Store.setAppState(repoName, stateData);
                  
                  if (window.Main && typeof window.Main.postMessageToApp === 'function') {
                    window.Main.postMessageToApp(repoName, 'PANOPTICON_LOAD', stateData);
                    console.log(`[Sync] Real-time state updated and posted to iframe for app: ${repoName}`);
                  }
                }
              }
            }
          }, (statesErr) => {
            console.error('Real-time app states sync failed:', statesErr);
          });

        } catch (err) {
          console.error('Failed to attach sync listener:', err);
        }
      } else {
        // Logged out
        if (window._syncUnsubscribe) {
          window._syncUnsubscribe();
          window._syncUnsubscribe = null;
        }
        if (window._statesUnsubscribe) {
          window._statesUnsubscribe();
          window._statesUnsubscribe = null;
        }
      }
    });
  }

  // --- Firestore Serialization Helper ---
  function sanitizeFirestoreData(data) {
    if (data === undefined) {
      return null;
    }
    if (data === null) {
      return null;
    }
    if (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) {
      if (data instanceof firebase.firestore.FieldValue) {
        return data;
      }
    }
    if (Array.isArray(data)) {
      return data.map(item => sanitizeFirestoreData(item));
    }
    if (typeof data === 'object') {
      if (data instanceof Date || data instanceof Blob || (typeof File !== 'undefined' && data instanceof File)) {
        return data;
      }
      const sanitized = {};
      for (const key of Object.keys(data)) {
        const val = data[key];
        if (val !== undefined) {
          sanitized[key] = sanitizeFirestoreData(val);
        }
      }
      return sanitized;
    }
    return data;
  }

  // --- Public API ---
  window.Auth = {
    showLogin: () => showModal('login'),
    showSignup: () => showModal('signup'),
    logout: () => auth.signOut(),

    syncToken: async (token) => {
      if (auth && auth.currentUser) {
        await db.collection('users').doc(auth.currentUser.uid).set(
          sanitizeFirestoreData({ ghToken: token || "" }),
          { merge: true }
        );
      }
    },

    // Nuclear Sync: Push all local data to cloud
    syncAll: async () => {
      if (!auth || !auth.currentUser) return;
      const uid = auth.currentUser.uid;
      const userRef = db.collection('users').doc(uid);
      
      const apps = await Store.getLinkedApps();
      const token = Store.getToken();
      
      const styles = await Store.getStyles();
      const audio = await Store.getAudioConfig();
      
      // Sync list, token, styles, and audio
      const payload = { 
        ghToken: token || "",
        linkedApps: apps || [],
        audioConfig: audio || null,
        lastSync: firebase.firestore.FieldValue.serverTimestamp()
      };
      
      if (styles && styles.accountSync !== false) {
        payload.stylesConfig = styles;
      } else {
        payload.stylesConfig = firebase.firestore.FieldValue.delete();
      }

      await userRef.set(sanitizeFirestoreData(payload), { merge: true });

      // Sync individual app states
      for (const app of apps) {
        const state = await Store.getAppState(app.repoName);
        if (state) {
          await userRef.collection('states').doc(app.repoName).set({
            payload: sanitizeFirestoreData(state),
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
