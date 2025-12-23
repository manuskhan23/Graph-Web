import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push } from 'firebase/database';

// Separate Firebase config for survey database
const surveyFirebaseConfig = {
  apiKey: "AIzaSyDGGbaWygUdLmUhwV7KSQL9l95NqX2dntU",
  authDomain: "survey-3e592.firebaseapp.com",
  databaseURL: "https://survey-3e592-default-rtdb.firebaseio.com",
  projectId: "survey-3e592",
  storageBucket: "survey-3e592.firebasestorage.app",
  messagingSenderId: "886856966640",
  appId: "1:886856966640:web:2458a43c8e122d7fba3d35",
  measurementId: "G-3TVQ5VKZGF"
};

// Initialize separate Firebase app for surveys
const surveyApp = initializeApp(surveyFirebaseConfig, 'survey');
const surveyDatabase = getDatabase(surveyApp);

export async function submitSurvey(surveyData) {
  try {
    const surveysRef = ref(surveyDatabase, 'surveys');
    await push(surveysRef, surveyData);
    return { success: true };
  } catch (error) {
    console.error('Error submitting survey:', error);
    throw error;
  }
}

export { surveyDatabase };
