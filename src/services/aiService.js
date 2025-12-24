// Use environment variable or default to localhost
const LOCAL_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// Try local backend first, fallback to Groq API
export async function sendMessage(message) {
  try {
    console.log('[INFO] Trying local backend first...');
    
    // Try local backend
    const localResponse = await Promise.race([
      fetch(`${LOCAL_API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
    ]);

    if (localResponse.ok) {
      const data = await localResponse.json();
      console.log('[OK] Response from local backend');
      return data;
    }
  } catch (localError) {
    console.log('[WARNING] Local backend unavailable, using Groq API...');
  }

  // Fallback to Groq API
  try {
    console.log('[INFO] Sending message to Groq API...');
    
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: message }],
        temperature: 0.7,
        max_tokens: 1024
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    const aiMessage = data.choices[0].message.content;
    
    console.log('[OK] Response from Groq API');
    return {
      success: true,
      message: aiMessage,
      user_message: message
    };
  } catch (error) {
    console.error('[ERROR] Error:', error.message);
    throw new Error(`AI Service Error: ${error.message}`);
  }
}

export async function checkBackendHealth() {
  try {
    // Check local backend
    const response = await Promise.race([
      fetch(`${LOCAL_API_URL}/health`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
    ]);
    
    const data = await response.json();
    console.log('[OK] Backend health:', data);
    return response.ok;
  } catch (error) {
    console.log('[WARNING] Local backend not available (will use Groq API)');
    return false;
  }
}