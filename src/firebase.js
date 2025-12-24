import { initializeApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "firebase/auth";
import {
  getDatabase,
  ref,
  set,
  get,
  serverTimestamp
} from "firebase/database";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBO0TVbpLYjrM688KqfxEGkhHSPHFsetd8",
  authDomain: "graph-website-5ed70.firebaseapp.com",
  databaseURL: "https://graph-website-5ed70-default-rtdb.firebaseio.com",
  projectId: "graph-website-5ed70",
  storageBucket:  "graph-website-5ed70.appspot.com",
  messagingSenderId: "1039960908870",
  appId: "1:1039960908870:web:5b4bb775339e563678d647",
  measurementId: "G-4TJWFY4TNF"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
const storage = getStorage(app);

setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('Failed to set persistence', err);
});

// ✅ Signup
export async function signup(email, password, name) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;
    
    await set(ref(database, `users/${uid}`), {
      email:  email,
      name: name,
      createdAt: serverTimestamp()
    });
    
    return uid;
  } catch (error) {
    throw error;
  }
}

// ✅ Login
export async function login(email, password) {
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    throw error;
  }
}

// ✅ Logout
export async function logout() {
  try {
    await signOut(auth);
  } catch (error) {
    throw error;
  }
}

// ✅ Get current user
export function getCurrentUser() {
  return auth.currentUser;
}

// ✅ Fetch user profile data
export async function getUserData(uid) {
  try {
    const snapshot = await get(ref(database, `users/${uid}`));
    return snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    console.error('Error fetching user data:', error);
    throw error;
  }
}

// ✅ Save graph data (FIXED - Clean data before saving)
export async function saveGraphData(uid, graphType, graphName, graphData) {
  try {
    const graphId = Date.now().toString();
    
    // Clean and validate data
    if (!graphData || !graphData.labels) {
      throw new Error('Invalid graph data structure');
    }

    // Ensure arrays are clean
    const labels = Array.isArray(graphData.labels) 
      ? graphData.labels.filter(l => l !== null && l !== undefined)
      : [];
    
    // Handle both flat data and datasets format
    let data = [];
    if (graphData.datasets) {
      // Multi-dataset format (Education graphs)
      data = graphData.datasets;
    } else if (graphData.data) {
      // Single dataset format
      data = Array.isArray(graphData.data) 
        ? graphData.data.filter(d => d !== null && d !== undefined && !isNaN(d))
        : [];
    }

    if (labels.length === 0) {
      throw new Error('Labels cannot be empty');
    }

    // Build clean graph object
    const cleanGraphData = {
      id: graphId,
      name: graphName || 'Untitled Graph',
      type: graphData.type || 'line',
      labels: labels,
      data: data,
      createdAt: serverTimestamp()
    };

    // Add optional fields if they exist
    if (graphData.metric) {
      cleanGraphData.metric = graphData.metric;
    }
    if (graphData.datasets) {
      cleanGraphData.datasets = graphData.datasets;
    }

    // Save to Firebase
    await set(ref(database, `graphs/${uid}/${graphType}/${graphId}`), cleanGraphData);
    
    return graphId;
  } catch (error) {
    console.error('Error saving graph:', error);
    throw error;
  }
}

// ✅ Get all graphs for a user in a category
export async function getUserGraphs(uid, graphType) {
  try {
    const snapshot = await get(ref(database, `graphs/${uid}/${graphType}`));
    return snapshot.exists() ? snapshot.val() : {};
  } catch (error) {
    console.error('Error fetching user graphs:', error);
    throw error;
  }
}

// ✅ Get single graph
export async function getGraph(uid, graphType, graphId) {
  try {
    const snapshot = await get(ref(database, `graphs/${uid}/${graphType}/${graphId}`));
    return snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    console.error('Error fetching graph:', error);
    throw error;
  }
}

// ✅ Update graph
export async function updateGraphData(uid, graphType, graphId, graphName, graphData) {
  try {
    const cleanGraphData = {
      name: graphName || 'Untitled Graph',
      type: graphData.type || 'line',
      labels: graphData.labels || [],
      data: graphData.data || [],
      updatedAt: serverTimestamp()
    };

    // Add optional fields if they exist
    if (graphData.metric) {
      cleanGraphData.metric = graphData.metric;
    }
    if (graphData.datasets) {
      cleanGraphData.datasets = graphData.datasets;
    }
    if (graphData.weatherType) {
      cleanGraphData.weatherType = graphData.weatherType;
    }

    await set(ref(database, `graphs/${uid}/${graphType}/${graphId}`), cleanGraphData);
    return graphId;
  } catch (error) {
    console.error('Error updating graph:', error);
    throw error;
  }
}

// ✅ Delete graph (Helper function)
export async function deleteGraph(uid, graphType, graphId) {
  try {
    const { remove } = await import('firebase/database');
    await remove(ref(database, `graphs/${uid}/${graphType}/${graphId}`));
  } catch (error) {
    console.error('Error deleting graph:', error);
    throw error;
  }
}

// ✅ Export getDatabase, database, set, and ref for operations
export { database, getDatabase, set, ref };

// ✅ Chat Management Functions

// ✅ Create new chat
export async function createChat(uid, chatName) {
  try {
    const chatId = Date.now().toString();
    const chatData = {
      id: chatId,
      name: chatName || 'New Chat',
      messages: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    
    await set(ref(database, `chats/${uid}/${chatId}`), chatData);
    return chatId;
  } catch (error) {
    console.error('Error creating chat:', error);
    throw error;
  }
}

// ✅ Get all chats for user
export async function getUserChats(uid) {
  try {
    const snapshot = await get(ref(database, `chats/${uid}`));
    return snapshot.exists() ? snapshot.val() : {};
  } catch (error) {
    console.error('Error fetching chats:', error);
    throw error;
  }
}

// ✅ Get single chat
export async function getChat(uid, chatId) {
  try {
    const snapshot = await get(ref(database, `chats/${uid}/${chatId}`));
    return snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    console.error('Error fetching chat:', error);
    throw error;
  }
}

// ✅ Save message to chat
export async function saveMessageToChat(uid, chatId, message) {
  try {
    const chat = await getChat(uid, chatId);
    if (!chat) {
      throw new Error('Chat not found');
    }
    
    const messages = chat.messages || [];
    messages.push({
      id: Date.now().toString(),
      ...message,
      timestamp: serverTimestamp()
    });
    
    await set(ref(database, `chats/${uid}/${chatId}/messages`), messages);
    await set(ref(database, `chats/${uid}/${chatId}/updatedAt`), serverTimestamp());
    
    return messages;
  } catch (error) {
    console.error('Error saving message:', error);
    throw error;
  }
}

// ✅ Update chat name
export async function updateChatName(uid, chatId, newName) {
  try {
    await set(ref(database, `chats/${uid}/${chatId}/name`), newName);
  } catch (error) {
    console.error('Error updating chat name:', error);
    throw error;
  }
}

// ✅ Delete chat
export async function deleteChat(uid, chatId) {
  try {
    const { remove } = await import('firebase/database');
    await remove(ref(database, `chats/${uid}/${chatId}`));
  } catch (error) {
    console.error('Error deleting chat:', error);
    throw error;
  }
}

// ✅ Upload file to chat
export async function uploadFileToChat(uid, chatId, file) {
  try {
    if (!file) {
      throw new Error('No file provided');
    }

    // Check file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new Error('File size must be less than 5MB');
    }

    // Create unique filename
    const timestamp = Date.now();
    const fileName = `${timestamp}_${file.name}`;
    const fileRef = storageRef(storage, `chats/${uid}/${chatId}/${fileName}`);

    // Upload file
    const snapshot = await uploadBytes(fileRef, file);
    
    // Get download URL
    const downloadURL = await getDownloadURL(snapshot.ref);

    return {
      name: file.name,
      type: file.type,
      size: file.size,
      url: downloadURL,
      uploadedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}

// ✅ Listen to auth state
export function onAuthStateReady(callback) {
  return onAuthStateChanged(auth, callback);
}

// ✅ Calculator History Functions

// Save calculator history entry
export async function saveCalculatorHistory(uid, historyEntry) {
  try {
    const entryId = Date.now().toString();
    const historyData = {
      id: entryId,
      entry: historyEntry,
      timestamp: serverTimestamp()
    };
    
    await set(ref(database, `calculatorHistory/${uid}/${entryId}`), historyData);
    return entryId;
  } catch (error) {
    console.error('Error saving calculator history:', error);
    throw error;
  }
}

// Get all calculator history for user
export async function getCalculatorHistory(uid) {
  try {
    const snapshot = await get(ref(database, `calculatorHistory/${uid}`));
    if (snapshot.exists()) {
      const data = snapshot.val();
      // Convert to array and sort by timestamp (newest first)
      return Object.values(data).sort((a, b) => b.timestamp - a.timestamp);
    }
    return [];
  } catch (error) {
    console.error('Error fetching calculator history:', error);
    throw error;
  }
}

// Delete single history entry
export async function deleteCalculatorHistoryEntry(uid, entryId) {
  try {
    const { remove } = await import('firebase/database');
    await remove(ref(database, `calculatorHistory/${uid}/${entryId}`));
  } catch (error) {
    console.error('Error deleting calculator history entry:', error);
    throw error;
  }
}

// Clear all calculator history for user
export async function clearAllCalculatorHistory(uid) {
  try {
    const { remove } = await import('firebase/database');
    await remove(ref(database, `calculatorHistory/${uid}`));
  } catch (error) {
    console.error('Error clearing calculator history:', error);
    throw error;
  }
}